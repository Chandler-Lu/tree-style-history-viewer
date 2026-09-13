const historyTreeDiv = document.getElementById("history-tree");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const maxResultsInput = document.getElementById("max-results");
const refreshButton = document.getElementById("refresh-button");
const loadingDiv = document.getElementById("loading");
const filterDuplicatesCheckbox = document.getElementById("filter-duplicates");
const searchInput = document.getElementById("search-input");
const summaryDiv = document.getElementById("summary");
const dateRangeButton = document.getElementById("date-range-button");
const dateRangeLabel = document.getElementById("date-range-label");
const datePicker = document.getElementById("date-picker");
const deleteButton = document.getElementById("delete-button");
const openSelectedButton = document.getElementById("open-selected-button");
const selectionActions = document.getElementById("selection-actions");
const selectionCount = document.getElementById("selection-count");
const unlimitedResultsCheckbox = document.getElementById("unlimited-results");
const limitHint = document.getElementById("limit-hint");
const olderHistory = document.getElementById("older-history");
const loadPreviousDayButton = document.getElementById("load-previous-day");
const STORAGE_KEY = "tree-history-viewer.preferences";
const DEFAULT_DAILY_VISITS = 300;
const locale = navigator.language && navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
let currentFullTree = [];
let requestSerial = 0;
let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let calendarPicking = "start";
const selectedUrls = new Set();
let lastSelectedCheckbox = null;
let focusOlderDate = null;
let previousScrollPosition = null;
let shiftSelecting = false;

const copy = {
  zh: { eyebrow: "浏览轨迹", title: "树状历史", subtitle: "按页面来源整理你的浏览历史，快速找回上下文。", quickRange: "快速范围", today: "今天", yesterday: "昨天", last7: "最近 7 天", last30: "最近 30 天", dateRange: "日期范围", startDate: "开始", endDate: "结束", maxResults: "每日最多访问", loadAll: "加载全部历史", loadPreviousDay: "加载前一天", search: "搜索", searchPlaceholder: "标题或网址", hideDuplicates: "隐藏连续重复", collapseAll: "全部折叠", expandAll: "全部展开", refresh: "刷新历史", openSelected: "全部打开", deleteSelected: "删除选中", selectedCount: (n) => `已选 ${n} 个网址`, loading: "正在读取历史…", count: (n, roots) => `显示 ${n} 条访问 · ${roots} 个起点`, noMatch: (q) => `没有找到匹配“${q}”的记录。`, noHistory: "所选范围内没有历史记录。", invalidDates: "请选择有效的日期范围。", failed: "读取历史失败，请检查扩展权限后重试。", copied: "链接已复制", pickStart: "请选择开始日期", pickEnd: "请选择结束日期", rangeSelected: "范围已选择，可继续调整", previousMonth: "上个月", nextMonth: "下个月", openConfirm: (n) => `确定打开选中的 ${n} 个网址吗？`, deleteConfirm: (n) => `确定删除选中的 ${n} 个网址的全部历史记录吗？`, deleteFailed: "删除失败，请稍后重试。", limitHint: (days, limit) => `当前 ${days} 天，共 ${limit} 条上限` },
  en: { eyebrow: "BROWSING TRAIL", title: "Tree Style History", subtitle: "Follow the source of each page and recover the context behind your browsing.", quickRange: "Quick range", today: "Today", yesterday: "Yesterday", last7: "Last 7 days", last30: "Last 30 days", dateRange: "Date range", startDate: "Start", endDate: "End", maxResults: "Visits per day", loadAll: "Load all history", loadPreviousDay: "Load previous day", search: "Search", searchPlaceholder: "Title or URL", hideDuplicates: "Hide consecutive duplicates", collapseAll: "Collapse all", expandAll: "Expand all", refresh: "Refresh history", openSelected: "Open all", deleteSelected: "Delete selected", selectedCount: (n) => `${n} URL(s) selected`, loading: "Reading history…", count: (n, roots) => `${n} visits · ${roots} starting points`, noMatch: (q) => `No records match “${q}”.`, noHistory: "No history in this date range.", invalidDates: "Choose a valid date range.", failed: "Could not read history. Check the extension permissions and try again.", copied: "Link copied", pickStart: "Choose a start date", pickEnd: "Choose an end date", rangeSelected: "Range selected; you can keep adjusting it", previousMonth: "Previous month", nextMonth: "Next month", openConfirm: (n) => `Open ${n} selected URL(s)?`, deleteConfirm: (n) => `Delete all history for ${n} selected URL(s)?`, deleteFailed: "Delete failed. Try again.", limitHint: (days, limit) => `${days} days · ${limit} visit limit` }
};
const t = (key, ...args) => typeof copy[locale][key] === "function" ? copy[locale][key](...args) : copy[locale][key];

function debounce(fn, wait) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; }
function dateInputValue(date) { const pad = (v) => String(v).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function localDate(value, endOfDay = false) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN; const [year, month, day] = value.split("-").map(Number); const date = new Date(year, month - 1, day); if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return Number.NaN; if (endOfDay) date.setHours(23, 59, 59, 999); return date.getTime(); }
function updateSelectionUi() { const hasSelection = selectedUrls.size > 0; selectionActions.hidden = !hasSelection; selectionCount.textContent = hasSelection ? t("selectedCount", selectedUrls.size) : ""; deleteButton.disabled = !hasSelection; openSelectedButton.disabled = !hasSelection; }
function setLoading(loading) { loadingDiv.hidden = !loading; refreshButton.disabled = loading; deleteButton.disabled = loading || selectedUrls.size === 0; openSelectedButton.disabled = loading || selectedUrls.size === 0; }
function rangeDays() { const start = localDate(startDateInput.value); const end = localDate(endDateInput.value, true); return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.max(1, Math.ceil((end - start + 1) / 86400000)) : 1; }
function updateLimitHint() { const base = Math.max(10, Number.parseInt(maxResultsInput.value, 10) || DEFAULT_DAILY_VISITS); const days = rangeDays(); limitHint.textContent = unlimitedResultsCheckbox.checked ? (locale === "zh" ? "不限制数量" : "No limit") : t("limitHint", days, (base * days).toLocaleString()); maxResultsInput.disabled = unlimitedResultsCheckbox.checked; }
function maybeShowOlderPrompt() { if (!loadingDiv.hidden) return; const pageNearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 72; const treeNearBottom = historyTreeDiv.scrollTop + historyTreeDiv.clientHeight >= historyTreeDiv.scrollHeight - 72; olderHistory.hidden = !(pageNearBottom || treeNearBottom); }
function loadPreviousDay() { const start = dateObject(startDateInput.value); if (!start) return; previousScrollPosition = { tree: historyTreeDiv.scrollTop }; loadPreviousDayButton.blur(); start.setDate(start.getDate() - 1); focusOlderDate = dateInputValue(start); startDateInput.value = focusOlderDate; updateDateRangeLabel(); olderHistory.hidden = true; fetchAndBuildTree(); }
function scrollToDateBoundary(dateValue) { requestAnimationFrame(() => { const target = [...historyTreeDiv.querySelectorAll(".node-row[data-date]")].find((row) => row.dataset.date === dateValue); if (target) { const containerRect = historyTreeDiv.getBoundingClientRect(); const targetRect = target.getBoundingClientRect(); const contextOffset = Math.min(120, historyTreeDiv.clientHeight * 0.28); historyTreeDiv.scrollTop += targetRect.top - containerRect.top - contextOffset; } else if (previousScrollPosition) { historyTreeDiv.scrollTop = previousScrollPosition.tree; } previousScrollPosition = null; }); }
function applyCopy() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}
function savePreferences() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ start: startDateInput.value, end: endDateInput.value, max: maxResultsInput.value, search: searchInput.value, duplicates: filterDuplicatesCheckbox.checked, unlimited: unlimitedResultsCheckbox.checked }));
}
function restorePreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) { maxResultsInput.value = saved.max || String(DEFAULT_DAILY_VISITS); searchInput.value = saved.search || ""; if (typeof saved.duplicates === "boolean") filterDuplicatesCheckbox.checked = saved.duplicates; if (typeof saved.unlimited === "boolean") unlimitedResultsCheckbox.checked = saved.unlimited; }
  } catch (_) { /* Ignore malformed local preferences. */ }
  const today = dateInputValue(new Date()); startDateInput.value = today; endDateInput.value = today;
}
function dateObject(value) { if (!value) return null; const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function updateDateRangeLabel() {
  const start = startDateInput.value; const end = endDateInput.value;
  dateRangeLabel.textContent = start && end ? `${start}  —  ${end}` : (start ? `${start}  —  ${t("pickEnd")}` : t("pickStart"));
}
function monthTitle(date) { return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en", { year: "numeric", month: "long" }); }
function renderMonth(month) {
  const wrapper = document.createElement("div"); wrapper.className = "calendar-month";
  const heading = document.createElement("h3"); heading.textContent = monthTitle(month); wrapper.appendChild(heading);
  const weekdays = document.createElement("div"); weekdays.className = "calendar-weekdays";
  const weekdayNames = locale === "zh" ? ["一", "二", "三", "四", "五", "六", "日"] : ["M", "T", "W", "T", "F", "S", "S"];
  weekdayNames.forEach((name) => { const cell = document.createElement("span"); cell.textContent = name; weekdays.appendChild(cell); }); wrapper.appendChild(weekdays);
  const days = document.createElement("div"); days.className = "calendar-days";
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1); const offset = (firstDay.getDay() + 6) % 7; const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let i = 0; i < offset; i += 1) days.appendChild(document.createElement("span"));
  for (let day = 1; day <= total; day += 1) {
    const date = new Date(month.getFullYear(), month.getMonth(), day); const value = dateInputValue(date); const button = document.createElement("button"); button.type = "button"; button.className = "calendar-day"; button.textContent = String(day); button.dataset.date = value;
    const todayValue = dateInputValue(new Date()); if (value > todayValue) { button.disabled = true; button.classList.add("future"); }
    if (value === startDateInput.value) button.classList.add("range-start"); if (value === endDateInput.value) button.classList.add("range-end"); if (startDateInput.value && endDateInput.value && value > startDateInput.value && value < endDateInput.value) button.classList.add("in-range");
    button.addEventListener("click", (event) => { event.stopPropagation(); if (!button.disabled) chooseDate(value); }); days.appendChild(button);
  }
  wrapper.appendChild(days); return wrapper;
}
function renderDatePicker() {
  datePicker.replaceChildren();
  const header = document.createElement("div"); header.className = "calendar-header";
  const prev = document.createElement("button"); prev.type = "button"; prev.className = "calendar-nav"; prev.textContent = "‹"; prev.title = t("previousMonth"); prev.setAttribute("aria-label", t("previousMonth")); prev.addEventListener("click", (event) => { event.stopPropagation(); calendarMonth.setMonth(calendarMonth.getMonth() - 1); renderDatePicker(); });
  const instruction = document.createElement("span"); instruction.className = "calendar-instruction"; instruction.textContent = startDateInput.value && endDateInput.value && calendarPicking === "start" ? t("rangeSelected") : (calendarPicking === "start" ? t("pickStart") : t("pickEnd"));
  const next = document.createElement("button"); next.type = "button"; next.className = "calendar-nav"; next.textContent = "›"; next.title = t("nextMonth"); next.setAttribute("aria-label", t("nextMonth")); next.addEventListener("click", (event) => { event.stopPropagation(); calendarMonth.setMonth(calendarMonth.getMonth() + 1); renderDatePicker(); });
  header.append(prev, instruction, next); datePicker.appendChild(header);
  const months = document.createElement("div"); months.className = "calendar-months"; months.appendChild(renderMonth(calendarMonth)); months.appendChild(renderMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))); datePicker.appendChild(months);
}
function chooseDate(value) {
  if (calendarPicking === "start" || (startDateInput.value && endDateInput.value)) { startDateInput.value = value; endDateInput.value = ""; calendarPicking = "end"; } else { if (value < startDateInput.value) { endDateInput.value = startDateInput.value; startDateInput.value = value; } else endDateInput.value = value; calendarPicking = "start"; datePicker.hidden = true; dateRangeButton.setAttribute("aria-expanded", "false"); fetchAndBuildTree(); }
  updateDateRangeLabel(); renderDatePicker();
}
function openDatePicker() { if (datePicker.hidden) { const anchor = dateObject(startDateInput.value) || new Date(); calendarMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1); calendarPicking = startDateInput.value && !endDateInput.value ? "end" : "start"; renderDatePicker(); datePicker.hidden = false; dateRangeButton.setAttribute("aria-expanded", "true"); } else { datePicker.hidden = true; dateRangeButton.setAttribute("aria-expanded", "false"); } }
function withTimeout(promise, milliseconds) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("History request timed out")), milliseconds))]); }
async function mapWithConcurrency(items, worker, concurrency = 8, shouldStop = () => false) { let cursor = 0; const run = async () => { while (cursor < items.length && !shouldStop()) { const index = cursor; cursor += 1; await worker(items[index], index); } }; await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run)); }
function countNodes(nodes) { return (nodes || []).reduce((total, node) => total + 1 + countNodes(node.children), 0); }
function filterConsecutiveDuplicatesInChildren(node) {
  if (!node?.children || node.children.length < 2) return;
  const kept = []; node.children.forEach((child) => { const previous = kept[kept.length - 1]; if (!previous || previous.data.historyItem.url !== child.data.historyItem.url) kept.push(child); });
  node.children = kept; node.children.forEach(filterConsecutiveDuplicatesInChildren);
}
function sortTree(node) {
  if (!node?.children?.length) return;
  node.children.sort((a, b) => a.data.visitData.visitTime - b.data.visitData.visitTime);
  node.children.forEach(sortTree);
}
function filterConsecutiveDuplicates(nodes) {
  const kept = [];
  (nodes || []).forEach((node) => {
    const previous = kept[kept.length - 1];
    if (!previous || previous.data.historyItem.url !== node.data.historyItem.url) kept.push(node);
  });
  return kept;
}
function filterAndCloneTree(nodes, query) {
  if (!query) return nodes || [];
  return (nodes || []).reduce((result, node) => {
    const item = node?.data?.historyItem; if (!item) return result;
    const matches = `${item.title || ""} ${item.url || ""}`.toLocaleLowerCase().includes(query);
    const children = filterAndCloneTree(node.children, query);
    if (matches || children.length) result.push({ ...node, children });
    return result;
  }, []);
}
function highlight(text, query) {
  const fragment = document.createDocumentFragment(); if (!query) { fragment.appendChild(document.createTextNode(text)); return fragment; }
  const lower = text.toLocaleLowerCase(); let start = 0; let index;
  while ((index = lower.indexOf(query, start)) !== -1) { fragment.appendChild(document.createTextNode(text.slice(start, index))); const mark = document.createElement("mark"); mark.textContent = text.slice(index, index + query.length); fragment.appendChild(mark); start = index + query.length; }
  fragment.appendChild(document.createTextNode(text.slice(start))); return fragment;
}
function renderTree(nodes) {
  historyTreeDiv.replaceChildren(); lastSelectedCheckbox = null;
  const query = searchInput.value.trim().toLocaleLowerCase();
  const count = countNodes(nodes); summaryDiv.textContent = count ? t("count", count, nodes.length) : "";
  if (!count) { const empty = document.createElement("p"); empty.className = "empty-state"; empty.textContent = query ? t("noMatch", searchInput.value.trim()) : t("noHistory"); historyTreeDiv.appendChild(empty); return; }
  const sorted = [...nodes].sort((a, b) => b.data.visitData.visitTime - a.data.visitData.visitTime); historyTreeDiv.appendChild(createTreeHtml(sorted, query));
}
function createTreeHtml(nodes, query) { const list = document.createElement("ul"); list.className = "history-tree-list"; nodes.forEach((node) => list.appendChild(renderNode(node, query))); return list; }
function renderNode(node, query) {
  const item = node.data.historyItem; const visit = node.data.visitData; const li = document.createElement("li");
  const row = document.createElement("div"); row.className = "node-row"; row.dataset.date = dateInputValue(new Date(visit.visitTime));
  const select = document.createElement("input"); select.type = "checkbox"; select.className = "node-select"; select.checked = selectedUrls.has(item.url); select.title = locale === "zh" ? "选择此网址" : "Select this URL"; select.setAttribute("aria-label", locale === "zh" ? "选择此网址" : "Select this URL"); select.addEventListener("click", (event) => { shiftSelecting = event.shiftKey; }); select.addEventListener("change", () => { const checkboxes = [...historyTreeDiv.querySelectorAll(".node-select")]; const currentIndex = checkboxes.indexOf(select); const lastIndex = lastSelectedCheckbox ? checkboxes.indexOf(lastSelectedCheckbox) : -1; if (shiftSelecting && lastIndex >= 0 && currentIndex >= 0) { const from = Math.min(lastIndex, currentIndex); const to = Math.max(lastIndex, currentIndex); checkboxes.slice(from, to + 1).forEach((checkbox) => { checkbox.checked = select.checked; if (select.checked) selectedUrls.add(checkbox.dataset.url); else selectedUrls.delete(checkbox.dataset.url); }); } else if (select.checked) selectedUrls.add(item.url); else selectedUrls.delete(item.url); shiftSelecting = false; lastSelectedCheckbox = select; updateSelectionUi(); }); select.dataset.url = item.url; row.appendChild(select);
  const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "toggle" + (node.children?.length ? "" : " empty"); toggle.textContent = node.children?.length ? "▾" : "·"; toggle.setAttribute("aria-label", node.children?.length ? "Toggle children" : "No children"); if (node.children?.length) toggle.setAttribute("aria-expanded", "true");
  row.appendChild(toggle);
  const favicon = document.createElement("img"); favicon.className = "favicon"; favicon.alt = ""; favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}`; favicon.onerror = () => { favicon.style.display = "none"; }; row.appendChild(favicon);
  const time = document.createElement("time"); time.className = "timestamp"; time.dateTime = new Date(visit.visitTime).toISOString(); time.textContent = new Date(visit.visitTime).toLocaleString(locale === "zh" ? "zh-CN" : undefined, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); row.appendChild(time);
  const link = document.createElement("a"); link.className = "node-link"; link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.title = item.url; link.appendChild(highlight(item.title || item.url, query)); row.appendChild(link);
  const copyButton = document.createElement("button"); copyButton.type = "button"; copyButton.className = "text-button copy-button"; copyButton.textContent = "↗"; copyButton.title = item.url; copyButton.setAttribute("aria-label", locale === "zh" ? "复制链接" : "Copy link"); copyButton.addEventListener("click", async () => { try { await navigator.clipboard.writeText(item.url); copyButton.textContent = "✓"; setTimeout(() => { copyButton.textContent = "↗"; }, 1200); } catch (_) { /* Clipboard may be unavailable in older Chrome versions. */ } }); row.appendChild(copyButton);
  li.appendChild(row);
  if (node.children?.length) { const children = document.createElement("ul"); children.className = "history-tree-children"; const sorted = [...node.children].sort((a, b) => a.data.visitData.visitTime - b.data.visitData.visitTime); sorted.forEach((child) => children.appendChild(renderNode(child, query))); li.appendChild(children); toggle.addEventListener("click", () => { const collapsed = children.hidden; children.hidden = !collapsed; toggle.textContent = collapsed ? "▾" : "▸"; toggle.setAttribute("aria-expanded", String(!children.hidden)); }); }
  return li;
}
function renderFilteredTree() { renderTree(filterAndCloneTree(currentFullTree, searchInput.value.trim().toLocaleLowerCase())); }

async function fetchAndBuildTree() {
  const serial = ++requestSerial; savePreferences(); setLoading(true); olderHistory.hidden = true; historyTreeDiv.replaceChildren(); summaryDiv.textContent = "";
  const hasDates = Boolean(startDateInput.value && endDateInput.value);
  const startTime = hasDates ? localDate(startDateInput.value) : Number.NaN; const endTime = hasDates ? localDate(endDateInput.value, true) : Number.NaN; const baseLimit = Math.max(10, Number.parseInt(maxResultsInput.value, 10) || DEFAULT_DAILY_VISITS); const maxResults = unlimitedResultsCheckbox.checked ? Number.POSITIVE_INFINITY : Math.min(100000, baseLimit * rangeDays()); maxResultsInput.value = baseLimit; updateLimitHint();
  if (!hasDates || Number.isNaN(startTime) || Number.isNaN(endTime) || startTime > endTime) { currentFullTree = []; const error = document.createElement("p"); error.className = "empty-state error-state"; error.textContent = t("invalidDates"); historyTreeDiv.appendChild(error); setLoading(false); return; }
  try {
    const selfUrl = chrome.runtime.getURL("history.html");
    // Search a broad candidate set first. `history.search` limits URLs, while
    // the user limit applies to final visits after filtering and deduplication.
    const itemLimit = 100000;
    const items = (await withTimeout(chrome.history.search({ text: "", startTime, endTime, maxResults: itemLimit }), 10000)).filter((item) => item.url && item.url !== selfUrl).slice(0, itemLimit);
    const visits = new Map();
    const visitLimit = Number.isFinite(maxResults) ? maxResults : Number.POSITIVE_INFINITY;
    await withTimeout(mapWithConcurrency(items, async (item) => { try { const detail = await withTimeout(chrome.history.getVisits({ url: item.url }), 4000); for (const visit of detail) { if (visits.size >= visitLimit) break; if (visit.visitTime >= startTime && visit.visitTime <= endTime && visit.transition !== "reload") visits.set(visit.visitId, { visitData: visit, historyItem: item }); } } catch (error) { console.warn("Could not get visits", item.url, error); } }, 8, () => Number.isFinite(visitLimit) && visits.size >= visitLimit), 20000).catch((error) => console.warn("Visit lookup took too long; rendering collected results", error));
    if (serial !== requestSerial) return;
    const limitedVisits = [...visits.entries()].sort((a, b) => b[1].visitData.visitTime - a[1].visitData.visitTime).slice(0, Number.isFinite(maxResults) ? maxResults : undefined);
    const nodes = new Map(); limitedVisits.forEach(([id, data]) => nodes.set(id, { id, data, children: [] })); const roots = [];
    nodes.forEach((node) => { const parent = nodes.get(node.data.visitData.referringVisitId); if (parent && parent.id !== node.id) parent.children.push(node); else roots.push(node); });
    currentFullTree = roots;
    currentFullTree.forEach(sortTree);
    currentFullTree.sort((a, b) => b.data.visitData.visitTime - a.data.visitData.visitTime);
    if (filterDuplicatesCheckbox.checked) { currentFullTree.forEach(filterConsecutiveDuplicatesInChildren); currentFullTree = filterConsecutiveDuplicates(currentFullTree); }
    renderFilteredTree();
    if (focusOlderDate) { const dateToFocus = focusOlderDate; focusOlderDate = null; scrollToDateBoundary(dateToFocus); }
  } catch (error) { if (serial === requestSerial) { focusOlderDate = null; previousScrollPosition = null; currentFullTree = []; const message = document.createElement("p"); message.className = "empty-state error-state"; message.textContent = t("failed"); historyTreeDiv.appendChild(message); console.error(error); } }
  finally { if (serial === requestSerial) { setLoading(false); maybeShowOlderPrompt(); } }
}
async function deleteSelected() {
  if (!selectedUrls.size || !window.confirm(t("deleteConfirm", selectedUrls.size))) return;
  const urls = [...selectedUrls]; setLoading(true);
  try { await withTimeout(Promise.all(urls.map((url) => chrome.history.deleteUrl({ url }))), 15000); selectedUrls.clear(); await fetchAndBuildTree(); }
  catch (error) { console.error(error); summaryDiv.textContent = t("deleteFailed"); setLoading(false); updateSelectionUi(); }
}
function openSelected() { if (!selectedUrls.size || !window.confirm(t("openConfirm", selectedUrls.size))) return; [...selectedUrls].forEach((url) => chrome.tabs.create({ url })); }
function setRange(range) { const today = new Date(); const end = new Date(today); const start = new Date(today); if (range === "yesterday") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); } else if (range !== "today") start.setDate(start.getDate() - Number(range) + 1); startDateInput.value = dateInputValue(start); endDateInput.value = dateInputValue(end); updateDateRangeLabel(); fetchAndBuildTree(); }
function toggleAll(collapsed) { historyTreeDiv.querySelectorAll(".history-tree-children").forEach((list) => { list.hidden = collapsed; }); historyTreeDiv.querySelectorAll(".toggle:not(.empty)").forEach((button) => { button.textContent = collapsed ? "▸" : "▾"; button.setAttribute("aria-expanded", String(!collapsed)); }); }

applyCopy(); restorePreferences(); updateDateRangeLabel(); updateLimitHint(); updateSelectionUi();
refreshButton.addEventListener("click", fetchAndBuildTree); startDateInput.addEventListener("change", fetchAndBuildTree); endDateInput.addEventListener("change", fetchAndBuildTree); filterDuplicatesCheckbox.addEventListener("change", fetchAndBuildTree);
dateRangeButton.addEventListener("click", openDatePicker);
deleteButton.addEventListener("click", deleteSelected);
openSelectedButton.addEventListener("click", openSelected);
loadPreviousDayButton.addEventListener("click", loadPreviousDay);
maxResultsInput.addEventListener("input", () => { updateLimitHint(); }); maxResultsInput.addEventListener("change", fetchAndBuildTree); unlimitedResultsCheckbox.addEventListener("change", fetchAndBuildTree); searchInput.addEventListener("input", debounce(() => { savePreferences(); renderFilteredTree(); }, 180));
document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => setRange(button.dataset.range)));
document.getElementById("collapse-button").addEventListener("click", () => toggleAll(true)); document.getElementById("expand-button").addEventListener("click", () => toggleAll(false));
document.addEventListener("click", (event) => { if (!datePicker.hidden && !datePicker.contains(event.target) && event.target !== dateRangeButton) { datePicker.hidden = true; dateRangeButton.setAttribute("aria-expanded", "false"); } });
document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !datePicker.hidden) { datePicker.hidden = true; dateRangeButton.setAttribute("aria-expanded", "false"); dateRangeButton.focus(); } if (event.key === "/" && document.activeElement !== searchInput && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); searchInput.focus(); } });
window.addEventListener("scroll", maybeShowOlderPrompt, { passive: true }); historyTreeDiv.addEventListener("scroll", maybeShowOlderPrompt, { passive: true }); window.addEventListener("resize", maybeShowOlderPrompt);
fetchAndBuildTree();
