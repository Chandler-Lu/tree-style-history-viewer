/**
 * history.js
 * Logic for the Tree Style History Viewer extension page.
 * Fetches history, builds a tree structure based on referrer,
 * filters/searches it, and renders it to the page.
 */

// --- DOM Element References ---
const historyTreeDiv = document.getElementById("history-tree");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const maxResultsInput = document.getElementById("max-results");
const refreshButton = document.getElementById("refresh-button");
const loadingDiv = document.getElementById("loading");
const filterDuplicatesCheckbox = document.getElementById("filter-duplicates");
const searchInput = document.getElementById("search-input"); // Added

// --- State Variable ---
let currentFullTree = []; // Stores the latest fetched & processed (but not search-filtered) tree root nodes

// --- Utility Functions ---

/**
 * Debounces a function call.
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Recursively filters consecutive duplicate URL visits within a node's children.
 */
function filterConsecutiveDuplicatesInChildren(node) {
  if (!node || !node.children || node.children.length < 2) {
    return;
  }
  const indicesToRemove = new Set();
  for (let i = 0; i < node.children.length - 1; i++) {
    const currentUrl = node.children[i]?.data?.historyItem?.url;
    const nextUrl = node.children[i + 1]?.data?.historyItem?.url;
    if (currentUrl && nextUrl && currentUrl === nextUrl) {
      indicesToRemove.add(i); // Mark previous for removal
    }
  }
  if (indicesToRemove.size > 0) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      if (indicesToRemove.has(i)) {
        node.children.splice(i, 1);
      }
    }
  }
  node.children.forEach((child) => filterConsecutiveDuplicatesInChildren(child));
}

/**
 * Recursively filters an array of nodes based on search text.
 * Keeps a node if it or any of its descendants match the search text (title or URL).
 * Returns a new array with cloned matching nodes and their filtered children.
 */
function filterAndCloneTree(nodes, searchTextLower) {
  if (!searchTextLower) {
    return nodes; // Return the original array if no search text
  }
  if (!nodes) {
    return [];
  }

  const filteredNodes = [];
  for (const node of nodes) {
    // Basic check for node integrity
    if (!node || !node.data || !node.data.historyItem) continue;

    const title = node.data.historyItem.title || "";
    const url = node.data.historyItem.url || "";
    const nodeMatches = title.toLowerCase().includes(searchTextLower) || url.toLowerCase().includes(searchTextLower);

    const filteredChildren = filterAndCloneTree(node.children, searchTextLower);

    if (nodeMatches || filteredChildren.length > 0) {
      // Clone node to avoid modifying the original 'currentFullTree'
      const clonedNode = { ...node, children: filteredChildren };
      filteredNodes.push(clonedNode);
    }
  }
  return filteredNodes;
}

// --- Rendering Logic ---

/**
 * Renders the tree view based on the provided nodes.
 * @param {Array} nodesToRender The array of root nodes to render.
 */
function renderTree(nodesToRender) {
  // Clear previous rendering
  historyTreeDiv.innerHTML = "";

  if (nodesToRender && nodesToRender.length > 0) {
    // Sort roots by time (most recent first) before rendering
    nodesToRender.sort((a, b) => b.data.visitData.visitTime - a.data.visitData.visitTime);
    const treeHtml = createTreeHtml(nodesToRender);
    historyTreeDiv.appendChild(treeHtml);
  } else {
    // Display appropriate message if nothing to render
    const searchTextValue = searchInput ? searchInput.value.trim() : "";
    if (searchTextValue) {
      historyTreeDiv.textContent = `No history items found matching "${searchTextValue}".`;
    } else if (currentFullTree.length > 0) {
      // This means the full tree exists but was completely filtered out by options (less likely)
      historyTreeDiv.textContent = "All history items were filtered out by the selected options.";
    } else {
      // This means the initial fetch found nothing matching date/maxResults criteria
      historyTreeDiv.textContent = "No history items found for the selected criteria.";
    }
  }
  // Ensure loading indicator is hidden *after* rendering attempt
  if (loadingDiv) loadingDiv.style.display = "none";
}

/**
 * Applies search filter to the stored full tree and triggers rendering.
 */
function renderFilteredTree() {
  const searchText = searchInput ? searchInput.value.trim().toLowerCase() : "";
  console.log(`Rendering tree with search filter: "${searchText}"`);
  const nodesToRender = filterAndCloneTree(currentFullTree, searchText);
  renderTree(nodesToRender);
}

// --- Core History Fetching and Tree Building ---

/**
 * Fetches history based on UI controls, filters it, builds the tree structure,
 * stores the full tree, and triggers rendering.
 */
async function fetchAndBuildTree() {
  if (loadingDiv) loadingDiv.style.display = "block"; // Show loading indicator
  historyTreeDiv.innerHTML = ""; // Clear tree immediately
  currentFullTree = []; // Reset the stored tree

  const historyPageUrl = chrome.runtime.getURL("history.html");
  const startTime = new Date(startDateInput.value).getTime();
  const endTime = new Date(endDateInput.value).getTime() + (24 * 60 * 60 * 1000 - 1);
  const maxResults = parseInt(maxResultsInput.value, 10) || 1000;
  const shouldFilterDuplicates = filterDuplicatesCheckbox && filterDuplicatesCheckbox.checked;

  if (isNaN(startTime) || isNaN(endTime)) {
    historyTreeDiv.textContent = "Invalid date range.";
    if (loadingDiv) loadingDiv.style.display = "none";
    return;
  }

  try {
    console.log(
      `Workspaceing history from ${new Date(startTime)} to ${new Date(
        endTime
      )}, maxResults base: ${maxResults}, filterDuplicates: ${shouldFilterDuplicates}`
    );
    const historyItemsRaw = await chrome.history.search({
      text: "", // Search text is NOT applied here, only client-side
      startTime: startTime,
      endTime: endTime,
      maxResults: maxResults + 50,
    });

    const historyItems = historyItemsRaw.filter((item) => item.url !== historyPageUrl);
    console.log(`Found ${historyItemsRaw.length} raw items, ${historyItems.length} after filtering self.`);

    // Don't proceed if no items after initial filter
    if (historyItems.length === 0) {
      currentFullTree = [];
      renderFilteredTree(); // Render "no results" message
      return;
    }

    const allVisitsMap = new Map();
    const urlVisitPromises = historyItems.map(async (item) => {
      try {
        const visits = await chrome.history.getVisits({ url: item.url });
        visits.forEach((visit) => {
          if (visit.visitTime >= startTime && visit.visitTime <= endTime) {
            if (visit.transition === "reload") return;
            if (!allVisitsMap.has(visit.visitId)) {
              allVisitsMap.set(visit.visitId, { visitData: visit, historyItem: item });
            }
          }
        });
      } catch (error) {
        console.warn(`Could not get visits for ${item.url}:`, error);
      }
    });
    await Promise.all(urlVisitPromises);
    console.log(`Collected details for ${allVisitsMap.size} non-reload, non-self visits.`);

    // Build the initial tree structure
    const nodes = {};
    const rootNodes = [];
    allVisitsMap.forEach((value, visitId) => {
      nodes[visitId] = { id: visitId, data: value, children: [] };
    });
    allVisitsMap.forEach((value, visitId) => {
      const referringVisitId = value.visitData.referringVisitId;
      const currentNode = nodes[visitId];
      if (referringVisitId && referringVisitId !== "0" && nodes[referringVisitId]) {
        const parentNode = nodes[referringVisitId];
        if (!parentNode.children.some((child) => child.id === currentNode.id)) {
          parentNode.children.push(currentNode);
        }
      } else {
        if (!rootNodes.some((root) => root.id === currentNode.id)) {
          rootNodes.push(currentNode);
        }
      }
    });
    const nonRootIds = new Set();
    Object.values(nodes).forEach((node) => {
      node.children.forEach((child) => nonRootIds.add(child.id));
    });
    let finalRootNodes = rootNodes.filter((node) => !nonRootIds.has(node.id));

    // Apply Consecutive Duplicate Filtering (Optional)
    if (shouldFilterDuplicates && finalRootNodes.length > 0) {
      console.log("Filtering consecutive duplicates...");
      finalRootNodes.forEach((rootNode) => filterConsecutiveDuplicatesInChildren(rootNode));
      const rootsToRemoveIndices = new Set();
      for (let i = 0; i < finalRootNodes.length - 1; i++) {
        const currentUrl = finalRootNodes[i]?.data?.historyItem?.url;
        const nextUrl = finalRootNodes[i + 1]?.data?.historyItem?.url;
        if (currentUrl && nextUrl && currentUrl === nextUrl) {
          rootsToRemoveIndices.add(i);
        }
      }
      if (rootsToRemoveIndices.size > 0) {
        const filteredRoots = [];
        for (let i = 0; i < finalRootNodes.length; i++) {
          if (!rootsToRemoveIndices.has(i)) {
            filteredRoots.push(finalRootNodes[i]);
          }
        }
        finalRootNodes = filteredRoots;
      }
      console.log(`Finished filtering duplicates, ${finalRootNodes.length} root nodes remaining.`);
    }

    // Store the fully processed tree
    currentFullTree = finalRootNodes;
    console.log(`Stored ${currentFullTree.length} root nodes in full tree.`);

    // Trigger Rendering based on current search filter
    renderFilteredTree();
  } catch (error) {
    console.error("Error fetching or building history tree:", error);
    historyTreeDiv.textContent = `An error occurred: ${error.message}`;
    currentFullTree = []; // Clear stored tree on error
    if (loadingDiv) loadingDiv.style.display = "none"; // Hide loading on error
  }
}

// --- Tree Rendering Functions ---

/**
 * Creates the top-level UL element for the history tree.
 */
function createTreeHtml(nodes) {
  const list = document.createElement("ul");
  list.className = "history-tree-list";
  // Nodes should be pre-sorted if needed before calling this
  nodes.forEach((node) => {
    list.appendChild(renderNode(node));
  });
  return list;
}

/**
 * Recursively renders a single node and its children.
 */
function renderNode(node) {
  const listItem = createNodeElement(node.data);
  if (node.children && node.children.length > 0) {
    const childrenList = document.createElement("ul");
    childrenList.className = "history-tree-children";
    // Sort children by time (oldest first within parent) before rendering
    node.children
      .sort((a, b) => a.data.visitData.visitTime - b.data.visitData.visitTime)
      .forEach((childNode) => {
        childrenList.appendChild(renderNode(childNode));
      });
    listItem.appendChild(childrenList);
  }
  return listItem;
}

/**
 * Creates a single list item (<li>) element for a history entry.
 */
function createNodeElement(nodeData) {
  // ... (createNodeElement function remains the same as previous version) ...
  const item = nodeData.historyItem;
  const visit = nodeData.visitData;
  const listItem = document.createElement("li");

  // Favicon
  const favicon = document.createElement("img");
  favicon.className = "favicon";
  try {
    favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}`;
  } catch (e) {
    console.warn("Error creating favicon URL for:", item.url, e);
  }
  favicon.alt = "";
  favicon.onerror = () => {
    favicon.style.display = "none";
  };
  listItem.appendChild(favicon);

  // Timestamp
  const timeSpan = document.createElement("span");
  timeSpan.className = "timestamp";
  timeSpan.textContent = new Date(visit.visitTime).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  listItem.appendChild(timeSpan);

  // Link
  const link = document.createElement("a");
  link.href = item.url;
  link.textContent = item.title || item.url;
  link.title = item.url;
  link.target = "_blank";
  listItem.appendChild(link);

  // Transition Type
  // const transitionSpan = document.createElement("span");
  // transitionSpan.className = "transition";
  // transitionSpan.textContent = ` (${visit.transition})`;
  // listItem.appendChild(transitionSpan);

  return listItem;
}

// --- Initialization ---

/**
 * Sets default values for the date input fields.
 */
// function initializeDates() {
//   const today = new Date();
//   const yesterday = new Date(today);
//   yesterday.setDate(today.getDate() - 1);
//   const formatDate = (date) => date.toISOString().split("T")[0];
//   if (!startDateInput.value) startDateInput.value = formatDate(yesterday);
//   if (!endDateInput.value) endDateInput.value = formatDate(today);
// }

// --- Event Listeners ---

// Listeners that trigger a full data re-fetch and rebuild
refreshButton.addEventListener("click", fetchAndBuildTree);
// startDateInput.addEventListener("change", fetchAndBuildTree);
// endDateInput.addEventListener("change", fetchAndBuildTree);
if (filterDuplicatesCheckbox) {
  filterDuplicatesCheckbox.addEventListener("change", fetchAndBuildTree);
}

// Debounced listener for Max Results (triggers full fetch)
const debouncedFetch = debounce(fetchAndBuildTree, 500);
maxResultsInput.addEventListener("input", debouncedFetch);

// Debounced listener for Search Input (triggers rendering only)
if (searchInput) {
  const debouncedRender = debounce(renderFilteredTree, 300); // Shorter delay for search
  searchInput.addEventListener("input", debouncedRender);
}

// --- Initial Load & Litepicker Setup ---
document.addEventListener('DOMContentLoaded', () => {、
  const picker = new Litepicker({
      element: document.getElementById('datepicker-container'),
      inlineMode: true,
      singleMode: false,
      numberOfMonths: 1,
      numberOfColumns: 1,
      format: 'YYYY-MM-DD', // Litepicker's display format (doesn't affect output object)
      showTooltip: true,
      autoApply: true,
      startDate: new Date(new Date().setDate(new Date().getDate() - 1)),
      endDate: new Date(),
      setup: (picker) => {
          picker.on('selected', (date1, date2) => {
              if (date1 && date2) {
                  const formatDateLocal = (litepickerDate) => {
                      if (!litepickerDate) return '';
                      const d = litepickerDate.toJSDate();
                      // console.log(`[DEBUG] JS Date for ${litepickerDate}:`, d);
                      const year = d.getFullYear();
                      const month = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      const formatted = `${year}-${month}-${day}`;
                      // console.log(`[DEBUG] Formatted Date String:`, formatted);
                      return formatted;
                  };

                  const startDateString = formatDateLocal(date1);
                  const endDateString = formatDateLocal(date2);

                  startDateInput.value = startDateString;
                  endDateInput.value = endDateString;
                  // console.log('[DEBUG] Set Input Values:', startDateInput.value, endDateInput.value);

                  fetchAndBuildTree();
              }
          });
      }
  });

  // **初始加载历史记录**
  // 手动设置一次隐藏 input 的值，确保首次加载使用正确格式的默认日期
  const formatDateLocalInitial = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
  };
  const today = new Date();
  const yesterday = new Date(new Date().setDate(today.getDate() - 1));
  if (!startDateInput.value) startDateInput.value = formatDateLocalInitial(yesterday);
  if (!endDateInput.value) endDateInput.value = formatDateLocalInitial(today);

  fetchAndBuildTree(); // Initial fetch and render
});