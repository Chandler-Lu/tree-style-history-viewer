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
const searchInput = document.getElementById("search-input");
const deleteSelectedButton = document.getElementById("delete-selected-button");

// --- State Variable ---
let currentFullTree = []; // Stores the latest fetched & processed (but not search-filtered) tree root nodes

// --- Constants ---
const BASE_MAX_RESULTS = 500;
const RESULTS_PER_DAY = 500;
const MAX_RESULTS_CAP = 20000;

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
    visibleCheckboxes = Array.from(historyTreeDiv.querySelectorAll(".history-item-checkbox"));
    console.log(`Rendered tree, found ${visibleCheckboxes.length} selectable items.`);
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
  const item = nodeData.historyItem;
  const visit = nodeData.visitData;
  const listItem = document.createElement("li");

  // Checkbox
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "history-item-checkbox";
  checkbox.dataset.url = item.url;
  checkbox.dataset.visitId = visit.visitId;
  listItem.appendChild(checkbox);

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

/**
 * Handles clicks on history item checkboxes, including Shift-click range selection.
 */
function handleCheckboxClick(event, clickedCheckbox) {
  // visibleCheckboxes should be up-to-date thanks to renderTree
  const currentIndex = visibleCheckboxes.indexOf(clickedCheckbox);

  if (currentIndex === -1) {
    console.warn("Clicked checkbox not found in visible list cache. Re-querying...");
    // Attempt to recover by re-querying, though this indicates a potential state issue
    visibleCheckboxes = Array.from(historyTreeDiv.querySelectorAll(".history-item-checkbox"));
    const newIndex = visibleCheckboxes.indexOf(clickedCheckbox);
    if (newIndex === -1) {
      console.error("Checkbox definitely not found in DOM.");
      return;
    }
    // If found after re-query, proceed but log the inconsistency
    console.warn("Checkbox found after re-query. Proceeding, but check render logic.");
    // Don't update lastCheckedIndex here, let the logic below handle it based on shift state
    // We use newIndex for the rest of this function call
    handleShiftClickLogic(event, clickedCheckbox, newIndex); // Pass index explicitly
  } else {
    handleShiftClickLogic(event, clickedCheckbox, currentIndex); // Use found index
  }
}

/** Separated logic for handling shift/normal click after index is known */
function handleShiftClickLogic(event, clickedCheckbox, currentIndex) {
  if (event.shiftKey && lastCheckedIndex !== -1 && lastCheckedIndex < visibleCheckboxes.length) {
    // Shift-click range selection
    const start = Math.min(lastCheckedIndex, currentIndex);
    const end = Math.max(lastCheckedIndex, currentIndex);
    const targetState = clickedCheckbox.checked; // State *after* the click determines range state

    console.log(`Shift-click: Setting range [${start}, ${end}] to state ${targetState}`);

    for (let i = start; i <= end; i++) {
      // Check array bounds and element existence
      if (visibleCheckboxes[i]) {
        visibleCheckboxes[i].checked = targetState;
      } else {
        console.warn(`Attempted to access checkbox at invalid index ${i} during shift-select.`);
      }
    }
    // Anchor (lastCheckedIndex) doesn't change on shift-click
  } else {
    // Normal click or shift-click without valid anchor
    console.log(`Normal click at index ${currentIndex}. Setting lastCheckedIndex.`);
    lastCheckedIndex = currentIndex;
  }
}

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

// Delete Selected Button Listener
if (deleteSelectedButton) {
  deleteSelectedButton.addEventListener("click", async () => {
    // 1. Find selected checkboxes within the currently rendered tree
    const selectedCheckboxes = historyTreeDiv.querySelectorAll(".history-item-checkbox:checked");

    if (selectedCheckboxes.length === 0) {
      alert("Please select history items to delete.");
      return;
    }

    // 2. Collect unique URLs to delete
    const urlsToDelete = new Set();
    selectedCheckboxes.forEach((checkbox) => {
      if (checkbox.dataset.url) {
        urlsToDelete.add(checkbox.dataset.url);
      }
    });

    if (urlsToDelete.size === 0) {
      alert("Could not identify URLs for selected items.");
      return;
    }

    // 3. **** CRITICAL: Confirm with strong warning ****
    const urlList = Array.from(urlsToDelete)
      .map((url) => `- ${url}`)
      .join("\n");
    const confirmationMessage = `WARNING!\nYou are about to delete ALL history records for the selected URL(s).`;

    if (!confirm(confirmationMessage)) {
      console.log("Deletion cancelled by user.");
      return;
    }

    // 4. Proceed with deletion
    console.log("Deleting URLs:", urlsToDelete);
    loadingDiv.style.display = "block"; // Show loading indicator during deletion

    let deletionErrors = 0;
    const deletionPromises = [];

    urlsToDelete.forEach((url) => {
      // Wrap the chrome API call in a promise for Promise.all
      const promise = new Promise((resolve, reject) => {
        chrome.history.deleteUrl({ url: url }, () => {
          if (chrome.runtime.lastError) {
            console.error(`Error deleting URL ${url}:`, chrome.runtime.lastError.message);
            reject(chrome.runtime.lastError);
          } else {
            console.log(`Successfully requested deletion for ${url}`);
            resolve();
          }
        });
      });
      deletionPromises.push(promise);
    });

    // Wait for all deletion requests to be processed (success or fail)
    const results = await Promise.allSettled(deletionPromises);

    results.forEach((result) => {
      if (result.status === "rejected") {
        deletionErrors++;
      }
    });

    await fetchAndBuildTree();
  });
}

// --- Initial Load & Litepicker Setup ---
document.addEventListener("DOMContentLoaded", () => {
  // Function to format date as YYYY-MM-DD using local time
  const formatDateLocal = (date) => {
    if (!date) return "";
    // Ensure date is a JS Date object
    const d = date instanceof Date ? date : date.toJSDate();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const picker = new Litepicker({
    element: document.getElementById("datepicker-container"),
    inlineMode: true,
    singleMode: false,
    numberOfMonths: 1,
    numberOfColumns: 1,
    format: "YYYY-MM-DD",
    showTooltip: true,
    autoApply: true,
    startDate: new Date(new Date().setDate(new Date().getDate() - 1)), // Yesterday
    endDate: new Date(), // Today
    setup: (picker) => {
      picker.on("selected", (date1, date2) => {
        if (date1 && date2) {
          // --- 1. Format dates and update hidden inputs ---
          const startDateString = formatDateLocal(date1);
          const endDateString = formatDateLocal(date2);
          startDateInput.value = startDateString;
          endDateInput.value = endDateString;

          // --- 2. Calculate date range duration ---
          const d1 = date1.toJSDate();
          const d2 = date2.toJSDate();
          d1.setHours(0, 0, 0, 0);
          d2.setHours(0, 0, 0, 0);
          const diffTime = Math.abs(d2.getTime() - d1.getTime());
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;

          // --- 3. Calculate and update Max Results ---
          let suggestedMax = BASE_MAX_RESULTS + Math.max(0, diffDays - 1) * RESULTS_PER_DAY;
          suggestedMax = Math.min(suggestedMax, MAX_RESULTS_CAP);
          suggestedMax = Math.max(suggestedMax, BASE_MAX_RESULTS);
          suggestedMax = Math.round(suggestedMax);

          // Update the input field value
          if (maxResultsInput) {
            maxResultsInput.value = suggestedMax;
          }
          fetchAndBuildTree();
        }
      });
    },
  });

  if (historyTreeDiv) {
    historyTreeDiv.addEventListener("click", (event) => {
      if (event.target && event.target.matches(".history-item-checkbox")) {
        handleCheckboxClick(event, event.target); // Use the dedicated handler
      }
    });
  }

  // --- Initial Setup on Load ---
  // Set initial hidden input dates based on Litepicker defaults
  const initialStartDate = picker.getStartDate()
    ? picker.getStartDate().toJSDate()
    : new Date(new Date().setDate(new Date().getDate() - 1));
  const initialEndDate = picker.getEndDate() ? picker.getEndDate().toJSDate() : new Date();
  startDateInput.value = formatDateLocal(initialStartDate);
  endDateInput.value = formatDateLocal(initialEndDate);

  // Calculate and set initial Max Results based on the default date range
  initialStartDate.setHours(0, 0, 0, 0);
  initialEndDate.setHours(0, 0, 0, 0);
  const initialDiffTime = Math.abs(initialEndDate.getTime() - initialStartDate.getTime());
  const initialDiffDays = Math.round(initialDiffTime / (1000 * 60 * 60 * 24)) + 1;
  let initialMax = BASE_MAX_RESULTS + Math.max(0, initialDiffDays - 1) * RESULTS_PER_DAY;
  initialMax = Math.min(initialMax, MAX_RESULTS_CAP);
  initialMax = Math.max(initialMax, BASE_MAX_RESULTS);
  if (maxResultsInput) {
    maxResultsInput.value = Math.round(initialMax);
    console.log(`[DEBUG] Initial Max Results set to: ${maxResultsInput.value}`);
  }

  fetchAndBuildTree();
});
