const state = {
  original: null,
  revised: null,
  result: null,
  filter: "all",
  query: "",
  view: "changes",
  aiConfigured: false,
  model: "",
};

const elements = {
  originalInput: document.querySelector("#originalInput"),
  revisedInput: document.querySelector("#revisedInput"),
  originalDropzone: document.querySelector("#originalDropzone"),
  revisedDropzone: document.querySelector("#revisedDropzone"),
  originalFile: document.querySelector("#originalFile"),
  revisedFile: document.querySelector("#revisedFile"),
  compareButton: document.querySelector("#compareButton"),
  resetButton: document.querySelector("#resetButton"),
  aiToggle: document.querySelector("#aiToggle"),
  apiStatus: document.querySelector("#apiStatus"),
  modelLabel: document.querySelector("#modelLabel"),
  footerModel: document.querySelector("#footerModel"),
  progressPanel: document.querySelector("#progressPanel"),
  progressTitle: document.querySelector("#progressTitle"),
  progressText: document.querySelector("#progressText"),
  progressBar: document.querySelector("#progressBar"),
  results: document.querySelector("#results"),
  resultTitle: document.querySelector("#resultTitle"),
  resultSubtitle: document.querySelector("#resultSubtitle"),
  statsGrid: document.querySelector("#statsGrid"),
  viewControl: document.querySelector("#viewControl"),
  changesView: document.querySelector("#changesView"),
  fullComparison: document.querySelector("#fullComparison"),
  fullCompareCount: document.querySelector("#fullCompareCount"),
  fullOriginalName: document.querySelector("#fullOriginalName"),
  fullRevisedName: document.querySelector("#fullRevisedName"),
  fullCompareList: document.querySelector("#fullCompareList"),
  filterControl: document.querySelector("#filterControl"),
  changeSearch: document.querySelector("#changeSearch"),
  changeList: document.querySelector("#changeList"),
  analysisPanel: document.querySelector("#analysisPanel"),
  analysisContent: document.querySelector("#analysisContent"),
  riskLabel: document.querySelector("#riskLabel"),
  exportButton: document.querySelector("#exportButton"),
  toast: document.querySelector("#toast"),
};

const typeLabels = {
  modified: "修改",
  added: "新增",
  deleted: "删除",
};

const severityLabels = {
  high: "高关注",
  medium: "中关注",
  low: "低关注",
  none: "无风险",
};

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => elements.toast.classList.remove("show"), 3000);
}

function isSupported(file) {
  return /\.(docx|pdf)$/i.test(file.name);
}

function setFile(side, file) {
  if (!file) return;
  if (!isSupported(file)) {
    toast("仅支持 DOCX 和 PDF 文件");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    toast("单个文件不能超过 25 MB");
    return;
  }

  state[side] = file;
  renderFile(side);
  updateControls();
}

function removeFile(side) {
  state[side] = null;
  elements[`${side}Input`].value = "";
  renderFile(side);
  updateControls();
}

function renderFile(side) {
  const file = state[side];
  const dropzone = elements[`${side}Dropzone`];
  const chip = elements[`${side}File`];

  if (!file) {
    dropzone.hidden = false;
    chip.hidden = true;
    chip.innerHTML = "";
    return;
  }

  dropzone.hidden = true;
  chip.hidden = false;
  chip.innerHTML = `
    <span class="file-type-icon"><i data-lucide="file-text"></i></span>
    <span class="file-copy">
      <strong title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</strong>
      <span>${escapeHtml(file.name.split(".").pop().toUpperCase())} · ${formatBytes(file.size)}</span>
    </span>
    <button class="remove-file" type="button" title="移除文件" data-remove="${side}">
      <i data-lucide="x"></i>
    </button>
  `;
  chip.querySelector("[data-remove]").addEventListener("click", () => removeFile(side));
  refreshIcons();
}

function updateControls() {
  const ready = Boolean(state.original && state.revised);
  elements.compareButton.disabled = !ready;
  elements.resetButton.disabled = !ready && !state.result;
}

function bindDropzone(side) {
  const input = elements[`${side}Input`];
  const dropzone = elements[`${side}Dropzone`];

  dropzone.addEventListener("click", () => input.click());
  input.addEventListener("change", () => setFile(side, input.files[0]));

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragging");
    });
  });

  dropzone.addEventListener("drop", (event) => setFile(side, event.dataTransfer.files[0]));
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    state.aiConfigured = status.aiConfigured;
    state.model = status.model;

    elements.apiStatus.className = `status-pill ${status.aiConfigured ? "ready" : "offline"}`;
    elements.apiStatus.innerHTML = `
      <span class="status-dot"></span>
      <span>${status.aiConfigured ? "AI 已连接" : "AI 未配置"}</span>
    `;
    elements.modelLabel.textContent = status.aiConfigured
      ? `${status.model} · 变更内容将提交研判`
      : "未配置 API Key，将仅执行基础对比";
    elements.footerModel.textContent = status.aiConfigured ? `模型：${status.model}` : "基础对比模式";
    elements.aiToggle.checked = status.aiConfigured;
    elements.aiToggle.disabled = !status.aiConfigured;
  } catch {
    elements.apiStatus.className = "status-pill offline";
    elements.apiStatus.innerHTML = '<span class="status-dot"></span><span>服务未连接</span>';
    elements.modelLabel.textContent = "无法读取模型配置";
    elements.aiToggle.checked = false;
    elements.aiToggle.disabled = true;
  }
}

function runProgress(useAi) {
  const steps = [
    ["正在读取与识别文档", "提取文本，扫描页面自动执行 OCR", 24],
    ["正在比对版本", "识别新增、删除与措辞变化", 58],
    useAi
      ? ["正在进行 AI 研判", "评估权利义务与法务风险", 86]
      : ["正在整理结果", "生成可筛选的变更清单", 86],
  ];
  let index = 0;

  const update = () => {
    const [title, text, percent] = steps[index];
    elements.progressTitle.textContent = title;
    elements.progressText.textContent = text;
    elements.progressBar.style.width = `${percent}%`;
    index = Math.min(index + 1, steps.length - 1);
  };

  update();
  return window.setInterval(update, useAi ? 1700 : 800);
}

async function compare() {
  if (!state.original || !state.revised) return;

  const formData = new FormData();
  formData.append("original", state.original);
  formData.append("revised", state.revised);
  formData.append("useAi", String(elements.aiToggle.checked));

  elements.compareButton.disabled = true;
  elements.compareButton.querySelector("span").textContent = "对比中";
  elements.progressPanel.hidden = false;
  elements.results.hidden = true;
  elements.progressBar.style.width = "10%";
  const timer = runProgress(elements.aiToggle.checked);

  try {
    const response = await fetch("/api/compare", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "对比失败");

    state.result = payload;
    state.filter = "all";
    state.query = "";
    state.view = "changes";
    elements.changeSearch.value = "";
    elements.filterControl.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === "all");
    });
    elements.viewControl.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === "changes");
    });
    elements.progressBar.style.width = "100%";
    renderResults();
    window.setTimeout(() => {
      elements.progressPanel.hidden = true;
      elements.results.hidden = false;
      elements.results.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
  } catch (error) {
    elements.progressPanel.hidden = true;
    const message =
      error instanceof TypeError
        ? "无法连接本地服务，请双击“启动法务文档对比台.cmd”后重试"
        : error.message;
    toast(message);
  } finally {
    window.clearInterval(timer);
    elements.compareButton.querySelector("span").textContent = "开始对比";
    updateControls();
  }
}

function statTemplate(label, value, color) {
  return `
    <div class="stat">
      <div class="stat-label"><span style="background:${color}"></span><span>${label}</span></div>
      <strong>${value}</strong>
    </div>
  `;
}

function renderResults() {
  const { files, comparison, aiError } = state.result;
  const count = comparison.changes.length;
  const ocrFiles = [files.original, files.revised].filter((file) => file.ocrUsed);
  const ocrPageCount = ocrFiles.reduce((sum, file) => sum + file.ocrPages.length, 0);
  elements.resultTitle.textContent = comparison.identical ? "两份文档正文一致" : `发现 ${count} 组变更`;
  elements.resultSubtitle.innerHTML =
    `${escapeHtml(files.original.name)}  →  ${escapeHtml(files.revised.name)} · ` +
    `${comparison.originalParagraphs} / ${comparison.revisedParagraphs} 个文本段落` +
    (ocrPageCount
      ? ` <span class="ocr-badge"><i data-lucide="scan-text"></i>OCR ${ocrPageCount} 页</span>`
      : "");

  elements.statsGrid.innerHTML = [
    statTemplate("实质修改", comparison.counts.modified, "#a86612"),
    statTemplate("新增内容", comparison.counts.added, "#116149"),
    statTemplate("删除内容", comparison.counts.deleted, "#a23b3b"),
    statTemplate("规则高关注", comparison.counts.high, "#315e85"),
  ].join("");

  renderChanges();
  renderFullComparison();
  renderAnalysis();
  setResultView(state.view);
  if (aiError) toast(aiError);
  refreshIcons();
}

function renderDiffSide(label, text, mode, wordDiff) {
  let content = '<span class="empty-text">无内容</span>';
  if (text) {
    if (mode === "original") {
      content = wordDiff
        .filter((part) => part.type !== "added")
        .map((part) =>
          part.type === "removed"
            ? `<del>${escapeHtml(part.value)}</del>`
            : escapeHtml(part.value),
        )
        .join("");
    } else {
      content = wordDiff
        .filter((part) => part.type !== "removed")
        .map((part) =>
          part.type === "added" ? `<ins>${escapeHtml(part.value)}</ins>` : escapeHtml(part.value),
        )
        .join("");
    }
  }

  return `
    <div class="diff-side">
      <div class="diff-label">${label}</div>
      <div class="diff-text">${content}</div>
    </div>
  `;
}

function renderChanges() {
  const changes = state.result.comparison.changes.filter((change) => {
    const matchesType = state.filter === "all" || change.type === state.filter;
    const haystack = `${change.location} ${change.original} ${change.revised}`.toLowerCase();
    return matchesType && haystack.includes(state.query.toLowerCase());
  });

  if (!changes.length) {
    elements.changeList.innerHTML = `
      <div class="list-empty">
        <i data-lucide="file-check-2"></i>
        ${state.result.comparison.identical ? "未发现文本差异" : "没有符合当前筛选的变更"}
      </div>
    `;
    refreshIcons();
    return;
  }

  elements.changeList.innerHTML = changes
    .map(
      (change) => `
        <article class="change-card" id="change-${change.id}">
          <div class="change-card-header">
            <div class="change-meta">
              <span class="change-id">${change.id}</span>
              <span class="tag ${change.type}">${typeLabels[change.type]}</span>
              <span class="tag ${change.severity}">${severityLabels[change.severity]}</span>
              <span class="change-location" title="${escapeHtml(change.location)}">${escapeHtml(change.location)}</span>
            </div>
            <button class="change-jump" type="button" data-full-jump="${change.id}" title="跳转到全文对照">
              <span>全文定位</span>
              <i data-lucide="arrow-up-right"></i>
            </button>
          </div>
          <div class="change-card-body">
            <div class="diff-grid">
              ${renderDiffSide("原稿", change.original, "original", change.wordDiff)}
              ${renderDiffSide("修订稿", change.revised, "revised", change.wordDiff)}
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  elements.changeList.querySelectorAll("[data-full-jump]").forEach((button) => {
    button.addEventListener("click", () => jumpToFullChange(button.dataset.fullJump));
  });
}

function renderFullText(row, side) {
  const text = row[side];
  if (!text) return '<span class="empty-text">本侧无对应内容</span>';
  if (row.type === "unchanged" || !row.wordDiff) return escapeHtml(text);

  const hiddenType = side === "original" ? "added" : "removed";
  const highlightedType = side === "original" ? "removed" : "added";
  const tag = side === "original" ? "del" : "ins";

  return row.wordDiff
    .filter((part) => part.type !== hiddenType)
    .map((part) =>
      part.type === highlightedType
        ? `<${tag}>${escapeHtml(part.value)}</${tag}>`
        : escapeHtml(part.value),
    )
    .join("");
}

function renderFullComparison() {
  const { files, comparison } = state.result;
  elements.fullOriginalName.textContent = files.original.name;
  elements.fullRevisedName.textContent = files.revised.name;
  elements.fullCompareCount.textContent =
    `${comparison.alignedParagraphs.length} 行对齐 · ${comparison.changes.length} 处变更`;

  elements.fullCompareList.innerHTML = comparison.alignedParagraphs
    .map(
      (row) => `
        <div class="full-compare-row ${row.type}" ${row.changeId ? `data-change="${row.changeId}"` : ""}>
          <div class="full-pane original">
            <span class="paragraph-number">${row.originalParagraph ? `A${row.originalParagraph}` : "A—"}</span>
            <div class="full-text">${renderFullText(row, "original")}</div>
          </div>
          <div class="full-pane revised">
            <span class="paragraph-number">${row.revisedParagraph ? `B${row.revisedParagraph}` : "B—"}</span>
            <div class="full-text">${renderFullText(row, "revised")}</div>
          </div>
        </div>
      `,
    )
    .join("");
}

function setResultView(view) {
  state.view = view;
  elements.changesView.hidden = view !== "changes";
  elements.fullComparison.hidden = view !== "full";
  elements.viewControl.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
}

function renderAnalysis() {
  const { ai, aiConfigured, model, comparison, aiError } = state.result;

  if (ai) {
    elements.riskLabel.textContent = severityLabels[ai.overallRisk] || "已完成";
    elements.riskLabel.style.color =
      ai.overallRisk === "high"
        ? "var(--red)"
        : ai.overallRisk === "medium"
          ? "var(--amber)"
          : "var(--green)";

    const findings = ai.keyFindings.length
      ? ai.keyFindings
          .map(
            (finding) => `
              <li class="finding ${finding.severity}">
                <button type="button" data-jump="${escapeHtml(finding.changeId)}">${escapeHtml(finding.changeId)}</button>
                <strong>${escapeHtml(finding.title)}</strong>
                <p>${escapeHtml(finding.impact)}</p>
                <p class="recommendation">建议：${escapeHtml(finding.recommendation)}</p>
              </li>
            `,
          )
          .join("")
      : '<li class="analysis-empty">没有需要单独提示的高风险变更</li>';

    const checklist = ai.negotiationChecklist.length
      ? ai.negotiationChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : "<li>当前没有额外谈判事项</li>";

    elements.analysisContent.innerHTML = `
      <p class="overview">${escapeHtml(ai.overview)}</p>
      <section class="insight-section">
        <h3>重点变更</h3>
        <ul class="finding-list">${findings}</ul>
      </section>
      <section class="insight-section">
        <h3>谈判核对项</h3>
        <ul class="checklist">${checklist}</ul>
      </section>
    `;
    elements.analysisContent.querySelectorAll("[data-jump]").forEach((button) => {
      button.addEventListener("click", () => jumpToChange(button.dataset.jump));
    });
  } else {
    elements.riskLabel.textContent = comparison.identical ? "未发现差异" : "未生成";
    elements.riskLabel.style.color = "var(--muted)";
    let message = "本次仅完成基础差异对比。";
    if (!aiConfigured) message = "配置 OPENAI_API_KEY 后可生成风险摘要与谈判建议。";
    if (aiError) message = aiError;

    elements.analysisContent.innerHTML = `
      <div class="analysis-empty">
        <i data-lucide="${comparison.identical ? "circle-check-big" : "sparkles"}"></i>
        ${escapeHtml(message)}
        ${aiConfigured ? `<br><small>模型：${escapeHtml(model)}</small>` : ""}
      </div>
    `;
  }
}

function jumpToChange(changeId) {
  state.filter = "all";
  state.query = "";
  state.view = "changes";
  elements.changeSearch.value = "";
  elements.filterControl.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === "all");
  });
  renderChanges();
  refreshIcons();
  const target = document.querySelector(`#change-${CSS.escape(changeId)}`);
  if (!target) return;
  target.classList.add("highlight");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("highlight"), 1800);
}

function jumpToFullChange(changeId) {
  setResultView("full");
  const target = document.querySelector(
    `.full-compare-row[data-change="${CSS.escape(changeId)}"]`,
  );
  if (!target) return;
  target.classList.add("highlight");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => target.classList.remove("highlight"), 1800);
}

function buildMarkdownReport() {
  const { files, comparison, ai, model } = state.result;
  const lines = [
    "# 法务文档对比报告",
    "",
    `- 原稿：${files.original.name}`,
    `- 修订稿：${files.revised.name}`,
    `- 变更组数：${comparison.changes.length}`,
    `- AI 模型：${ai ? model : "未启用"}`,
    "",
  ];

  if (ai) {
    lines.push("## AI 研判", "", `**总体风险：${severityLabels[ai.overallRisk]}**`, "", ai.overview, "");
    if (ai.keyFindings.length) {
      lines.push("### 重点变更", "");
      ai.keyFindings.forEach((finding) => {
        lines.push(
          `#### ${finding.changeId} ${finding.title}`,
          "",
          `- 风险：${severityLabels[finding.severity]}`,
          `- 影响：${finding.impact}`,
          `- 建议：${finding.recommendation}`,
          "",
        );
      });
    }
    if (ai.negotiationChecklist.length) {
      lines.push("### 谈判核对项", "");
      ai.negotiationChecklist.forEach((item) => lines.push(`- [ ] ${item}`));
      lines.push("");
    }
  }

  lines.push("## 逐项差异", "");
  comparison.changes.forEach((change) => {
    lines.push(
      `### ${change.id} ${typeLabels[change.type]} · ${severityLabels[change.severity]}`,
      "",
      `位置：${change.location}`,
      "",
      "**原稿**",
      "",
      change.original || "（无）",
      "",
      "**修订稿**",
      "",
      change.revised || "（无）",
      "",
    );
  });
  lines.push("---", "", "AI 结果用于辅助审阅，不构成法律意见。");
  return lines.join("\n");
}

function exportReport() {
  if (!state.result) return;
  const blob = new Blob([buildMarkdownReport()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `法务文档对比报告-${new Date().toISOString().slice(0, 10)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function reset() {
  state.original = null;
  state.revised = null;
  state.result = null;
  state.filter = "all";
  state.query = "";
  elements.originalInput.value = "";
  elements.revisedInput.value = "";
  elements.results.hidden = true;
  elements.progressPanel.hidden = true;
  renderFile("original");
  renderFile("revised");
  updateControls();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

elements.compareButton.addEventListener("click", compare);
elements.resetButton.addEventListener("click", reset);
elements.exportButton.addEventListener("click", exportReport);
elements.viewControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  setResultView(button.dataset.view);
});
elements.filterControl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  elements.filterControl.querySelectorAll("button").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  renderChanges();
  refreshIcons();
});
elements.changeSearch.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  renderChanges();
  refreshIcons();
});

bindDropzone("original");
bindDropzone("revised");
refreshIcons();
loadStatus();
