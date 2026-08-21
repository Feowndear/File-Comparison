import { diffArrays, diffWordsWithSpace } from "diff";

const HIGH_RISK_PATTERN =
  /违约|赔偿|责任限制|无限责任|连带责任|解除|终止|知识产权|保密|数据|隐私|管辖|仲裁|排他|独家|保证|担保|indemn|liabil|terminat|intellectual property|confidential|privacy|jurisdiction|arbitration/i;
const MEDIUM_RISK_PATTERN =
  /付款|支付|费用|价格|期限|交付|验收|续期|通知|发票|税|服务水平|payment|fee|price|term|delivery|acceptance|renew|notice|invoice|tax|service level/i;

export function cleanExtractedText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\u00a0]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n[ ]+/g, "\n")
    .replace(/[ ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function splitIntoUnits(value) {
  const text = cleanExtractedText(value);
  if (!text) return [];

  let units = text
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (units.length < 4) {
    units = text
      .split(/(?<=[。！？；.!?;])\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return units.flatMap((unit) => {
    if (unit.length <= 1200) return unit;
    return unit
      .split(/(?<=[。！？；.!?;])\s*/)
      .map((item) => item.trim())
      .filter(Boolean);
  });
}

function normalizeUnit(value) {
  return value.replace(/\s+/g, " ").trim();
}

function classifySeverity(text) {
  if (HIGH_RISK_PATTERN.test(text)) return "high";
  if (MEDIUM_RISK_PATTERN.test(text)) return "medium";
  return "low";
}

function buildWordDiff(original, revised) {
  if (!original) return [{ type: "added", value: revised }];
  if (!revised) return [{ type: "removed", value: original }];

  return diffWordsWithSpace(original, revised).map((part) => ({
    type: part.added ? "added" : part.removed ? "removed" : "same",
    value: part.value,
  }));
}

function clauseKey(value) {
  return (
    normalizeUnit(value).match(
      /^(第[一二三四五六七八九十百千0-9]+[条款章节]|[0-9]+(?:\.[0-9]+)*[.、]?)/,
    )?.[1] || ""
  );
}

function contextLabel(original, revised, units, index) {
  const current = original || revised;
  const key = clauseKey(current);
  if (key) {
    const summary = normalizeUnit(current).slice(key.length).replace(/^[\s:：.、-]+/, "").slice(0, 38);
    return summary ? `${key} · ${summary}` : key;
  }

  for (let cursor = Math.min(index - 1, units.length - 1); cursor >= 0; cursor -= 1) {
    const candidate = units[cursor];
    if (candidate && candidate.length <= 80) return candidate;
  }
  return `第 ${Math.max(index + 1, 1)} 段附近`;
}

function createChange({
  number,
  original,
  revised,
  originalParagraph,
  revisedParagraph,
  originalUnits,
}) {
  const type = original && revised ? "modified" : original ? "deleted" : "added";
  const combinedText = `${original}\n${revised}`;

  return {
    id: `C${String(number).padStart(3, "0")}`,
    type,
    severity: classifySeverity(combinedText),
    location: contextLabel(original, revised, originalUnits, (originalParagraph || 1) - 1),
    original,
    revised,
    originalParagraph,
    revisedParagraph,
    wordDiff: buildWordDiff(original, revised),
  };
}

function alignChangedBlock(removed, added) {
  if (removed.length <= 1 && added.length <= 1) {
    const originalKey = removed[0] ? clauseKey(removed[0]) : "";
    const revisedKey = added[0] ? clauseKey(added[0]) : "";
    if (originalKey && revisedKey && originalKey !== revisedKey) {
      return [
        { originalOffset: 0, revisedOffset: null },
        { originalOffset: null, revisedOffset: 0 },
      ];
    }
    return [{ originalOffset: removed.length ? 0 : null, revisedOffset: added.length ? 0 : null }];
  }

  const pairs = [];
  const usedAdded = new Set();

  removed.forEach((original, originalOffset) => {
    const key = clauseKey(original);
    const revisedOffset = key
      ? added.findIndex((revised, index) => !usedAdded.has(index) && clauseKey(revised) === key)
      : -1;

    if (revisedOffset >= 0) {
      usedAdded.add(revisedOffset);
      pairs.push({ originalOffset, revisedOffset });
    }
  });

  removed.forEach((_original, originalOffset) => {
    if (pairs.some((pair) => pair.originalOffset === originalOffset)) return;
    const originalKey = clauseKey(removed[originalOffset]);
    const compatibleIndex = added.findIndex(
      (revised, index) =>
        !usedAdded.has(index) && (!originalKey || !clauseKey(revised)),
    );
    const preferred =
      added[originalOffset] &&
      !usedAdded.has(originalOffset) &&
      (!originalKey || !clauseKey(added[originalOffset]))
        ? originalOffset
        : -1;
    const revisedOffset = preferred >= 0 ? preferred : compatibleIndex;

    if (revisedOffset >= 0) usedAdded.add(revisedOffset);
    pairs.push({ originalOffset, revisedOffset: revisedOffset >= 0 ? revisedOffset : null });
  });

  added.forEach((_revised, revisedOffset) => {
    if (!usedAdded.has(revisedOffset)) {
      pairs.push({ originalOffset: null, revisedOffset });
    }
  });

  return pairs.sort((left, right) => {
    const leftOrder = left.revisedOffset ?? left.originalOffset ?? 0;
    const rightOrder = right.revisedOffset ?? right.originalOffset ?? 0;
    return leftOrder - rightOrder;
  });
}

export function compareDocuments(originalText, revisedText) {
  const originalUnits = splitIntoUnits(originalText);
  const revisedUnits = splitIntoUnits(revisedText);
  const parts = diffArrays(originalUnits, revisedUnits, {
    comparator: (left, right) => normalizeUnit(left) === normalizeUnit(right),
  });

  const changes = [];
  const alignedParagraphs = [];
  let originalIndex = 0;
  let revisedIndex = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];

    if (!part.added && !part.removed) {
      part.value.forEach((value, offset) => {
        alignedParagraphs.push({
          row: alignedParagraphs.length + 1,
          changeId: null,
          type: "unchanged",
          original: value,
          revised: value,
          originalParagraph: originalIndex + offset + 1,
          revisedParagraph: revisedIndex + offset + 1,
          wordDiff: null,
        });
      });
      originalIndex += part.value.length;
      revisedIndex += part.value.length;
      continue;
    }

    const removed = [];
    const added = [];
    const startOriginal = originalIndex;
    const startRevised = revisedIndex;

    while (index < parts.length && (parts[index].added || parts[index].removed)) {
      const changedPart = parts[index];
      if (changedPart.removed) {
        removed.push(...changedPart.value);
        originalIndex += changedPart.value.length;
      }
      if (changedPart.added) {
        added.push(...changedPart.value);
        revisedIndex += changedPart.value.length;
      }
      index += 1;
    }
    index -= 1;

    alignChangedBlock(removed, added).forEach(({ originalOffset, revisedOffset }) => {
      const original = originalOffset === null ? "" : removed[originalOffset];
      const revised = revisedOffset === null ? "" : added[revisedOffset];
      const change = createChange({
        number: changes.length + 1,
        original,
        revised,
        originalParagraph: original ? startOriginal + originalOffset + 1 : null,
        revisedParagraph: revised ? startRevised + revisedOffset + 1 : null,
        originalUnits,
      });
      changes.push(change);
      alignedParagraphs.push({
        row: alignedParagraphs.length + 1,
        changeId: change.id,
        type: change.type,
        original: change.original,
        revised: change.revised,
        originalParagraph: change.originalParagraph,
        revisedParagraph: change.revisedParagraph,
        wordDiff: change.wordDiff,
      });
    });
  }

  const counts = changes.reduce(
    (result, change) => {
      result[change.type] += 1;
      result[change.severity] += 1;
      return result;
    },
    { added: 0, deleted: 0, modified: 0, high: 0, medium: 0, low: 0 },
  );

  return {
    identical: changes.length === 0,
    changes,
    alignedParagraphs,
    counts,
    originalParagraphs: originalUnits.length,
    revisedParagraphs: revisedUnits.length,
  };
}
