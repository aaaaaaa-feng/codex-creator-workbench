import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

const BRIEF_NAME = /(AIHOT.*简报|热点.*简报|灵感池).*\.md$/i;

function cleanInline(value = "") {
  return value.replace(/^\*\*|\*\*$/g, "").replace(/\s+/g, " ").trim();
}

function fieldValue(block, labels) {
  for (const label of labels) {
    const match = block.match(new RegExp(`^-\\s*${label}[：:]\\s*(.+)$`, "m"));
    if (match) return cleanInline(match[1]);
  }
  return "";
}

function linksIn(block) {
  const links = [];
  for (const match of block.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    links.push({ label: cleanInline(match[1]), url: match[2] });
  }
  return links;
}

export function parseInspirationBrief(content, metadata = {}) {
  const headings = [...content.matchAll(/^###\s+(\d+)[.、]\s+(.+?)\s*$/gm)];
  const items = [];

  for (let index = 0; index < headings.length && items.length < 5; index += 1) {
    const heading = headings[index];
    const rank = Number.parseInt(heading[1], 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > 20) continue;

    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    const block = content.slice(start, end);
    const links = linksIn(block);
    const aihot = links.find((link) => /aihot/i.test(link.label) || /aihot\.virxact\.com/i.test(link.url));
    const source = links.find((link) => link !== aihot && /原文|来源|公告|媒体/i.test(link.label));
    const summary = fieldValue(block, ["发生了什么", "一句话", "内容摘要"]);
    const whyItMatters = fieldValue(block, ["为什么重要", "普通人为什么在意", "为什么值得讲"]);

    if (!summary && !aihot) continue;

    const relativePath = metadata.relativePath || "";
    items.push({
      id: `${relativePath || metadata.title || "brief"}::${rank}`,
      rank,
      title: cleanInline(heading[2]),
      summary,
      whyItMatters,
      aihotUrl: aihot?.url || "",
      sourceUrl: source?.url || "",
      sourceLabel: source?.label || "原始来源",
      verification: source ? "已有原文" : "待核验",
    });
  }

  return {
    title: metadata.title || cleanInline(content.match(/^#\s+(.+)$/m)?.[1] || "今日热点简报"),
    relativePath: metadata.relativePath || "",
    updatedAt: metadata.updatedAt || "",
    items,
  };
}

export async function loadLatestInspirationBrief(workspaceRoot) {
  const inbox = join(workspaceRoot, "00_收件箱");
  let entries = [];
  try {
    entries = await readdir(inbox, { withFileTypes: true });
  } catch {
    return { title: "今日灵感池", relativePath: "", updatedAt: "", items: [] };
  }

  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !BRIEF_NAME.test(entry.name)) continue;
    const absolutePath = join(inbox, entry.name);
    const fileStat = await stat(absolutePath);
    candidates.push({ absolutePath, updatedAt: fileStat.mtime.toISOString() });
  }
  candidates.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  for (const candidate of candidates) {
    const content = await readFile(candidate.absolutePath, "utf8");
    const relativePath = relative(workspaceRoot, candidate.absolutePath).split(sep).join("/");
    const parsed = parseInspirationBrief(content, {
      relativePath,
      updatedAt: candidate.updatedAt,
      title: basename(candidate.absolutePath, ".md"),
    });
    if (parsed.items.length) return parsed;
  }

  return { title: "今日灵感池", relativePath: "", updatedAt: "", items: [] };
}
