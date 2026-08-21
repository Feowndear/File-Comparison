import test from "node:test";
import assert from "node:assert/strict";
import { compareDocuments, splitIntoUnits } from "../src/compare.js";

test("splits legal text into usable units", () => {
  const units = splitIntoUnits("第一条 服务期限。\n第二条 服务费用。\n第三条 保密义务。");
  assert.deepEqual(units, ["第一条 服务期限。", "第二条 服务费用。", "第三条 保密义务。"]);
});

test("detects modified, added and deleted clauses", () => {
  const original = [
    "第一条 服务期限为一年。",
    "第二条 服务费用为人民币十万元。",
    "第三条 双方承担对等保密义务。",
  ].join("\n");
  const revised = [
    "第一条 服务期限为两年。",
    "第二条 服务费用为人民币十万元。",
    "第四条 乙方承担无限赔偿责任。",
  ].join("\n");

  const result = compareDocuments(original, revised);

  assert.equal(result.identical, false);
  assert.equal(result.changes.length, 3);
  assert.equal(result.alignedParagraphs.length, 4);
  assert.equal(result.alignedParagraphs.filter((row) => row.type === "unchanged").length, 1);
  assert.deepEqual(
    result.alignedParagraphs.map((row) => row.type),
    ["modified", "unchanged", "deleted", "added"],
  );
  assert.ok(result.counts.high >= 1);
  assert.ok(result.changes.some((change) => change.revised.includes("无限赔偿责任")));
});

test("keeps numbered clauses as separate change groups", () => {
  const original = [
    "第一条 服务期限为一年。",
    "第二条 付款期限为三十日。",
    "第三条 责任以合同金额为上限。",
  ].join("\n");
  const revised = [
    "第一条 服务期限为两年。",
    "第二条 付款期限为十日。",
    "第三条 责任不设上限。",
    "第四条 客户可以随时终止。",
  ].join("\n");

  const result = compareDocuments(original, revised);

  assert.equal(result.changes.length, 4);
  assert.deepEqual(
    result.changes.map((change) => change.type),
    ["modified", "modified", "modified", "added"],
  );
  assert.match(result.changes[0].location, /^第一条/);
  assert.match(result.changes[3].location, /^第四条/);
  assert.equal(result.alignedParagraphs.length, 4);
});

test("reports identical normalized text", () => {
  const result = compareDocuments("第一条  服务内容", "第一条 服务内容");
  assert.equal(result.identical, true);
  assert.equal(result.changes.length, 0);
  assert.equal(result.alignedParagraphs.length, 1);
  assert.equal(result.alignedParagraphs[0].type, "unchanged");
});
