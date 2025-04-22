/**
 * history.js
 * Logic for the Tree Style History Viewer extension page.
 * Fetches history, builds a tree structure based on referrer,
 * and renders it to the page. Includes options for filtering.
 */

// --- DOM Element References ---
const historyTreeDiv = document.getElementById("history-tree");
const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const maxResultsInput = document.getElementById("max-results");
const refreshButton = document.getElementById("refresh-button");
const loadingDiv = document.getElementById("loading");
const filterDuplicatesCheckbox = document.getElementById("filter-duplicates"); // Added

// --- Utility Functions ---

/**
 * Debounces a function call.
 * @param {Function} func The function to debounce.
 * @param {number} wait The debounce delay in milliseconds.
 * @returns {Function} The debounced function.
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
 * Modifies the node's children array in place, keeping the last visit in a sequence.
 * @param {object} node The tree node whose children should be filtered.
 */
function filterConsecutiveDuplicatesInChildren(node) {
  if (!node || !node.children || node.children.length < 2) {
    return; // Base case: No children or only one child, nothing to compare
  }

  const indicesToRemove = new Set();
  // Iterate comparing current child (i) with the NEXT one (i+1)
  for (let i = 0; i < node.children.length - 1; i++) {
    // Ensure data structure is as expected before accessing properties
    const currentUrl = node.children[i]?.data?.historyItem?.url;
    const nextUrl = node.children[i + 1]?.data?.historyItem?.url;

    if (currentUrl && nextUrl && currentUrl === nextUrl) {
      // If current URL is same as next, mark CURRENT one for removal
      // This way, we keep the last one in a sequence
      indicesToRemove.add(i);
    }
  }

  // Remove marked items by iterating backwards (safer for splicing)
  if (indicesToRemove.size > 0) {
    for (let i = node.children.length - 1; i >= 0; i--) {
      if (indicesToRemove.has(i)) {
        node.children.splice(i, 1);
      }
    }
  }

  // After filtering this node's children, recursively call for remaining children
  node.children.forEach((child) => filterConsecutiveDuplicatesInChildren(child));
}

// --- Core History Fetching and Tree Building ---

/**
 * Fetches history based on UI controls, filters it,
 * builds the tree structure, and triggers rendering.
 */
async function fetchAndBuildTree() {
  historyTreeDiv.innerHTML = ""; // Clear previous tree
  loadingDiv.style.display = "block"; // Show loading indicator

  // --- 1. Get User Inputs & Options ---
  const historyPageUrl = chrome.runtime.getURL("history.html"); // URL to filter out
  const startTime = new Date(startDateInput.value).getTime();
  // Set end time to the end of the selected day
  const endTime = new Date(endDateInput.value).getTime() + (24 * 60 * 60 * 1000 - 1);
  const maxResults = parseInt(maxResultsInput.value, 10) || 1000;
  const shouldFilterDuplicates = filterDuplicatesCheckbox && filterDuplicatesCheckbox.checked;

  if (isNaN(startTime) || isNaN(endTime)) {
    historyTreeDiv.textContent = "Invalid date range.";
    loadingDiv.style.display = "none";
    return;
  }

  try {
    console.log(
      `Workspaceing history from ${new Date(startTime)} to ${new Date(
        endTime
      )}, maxResults base: ${maxResults}, filterDuplicates: ${shouldFilterDuplicates}`
    );

    // --- 2. Fetch Initial History & Perform Basic Filtering ---
    const historyItemsRaw = await chrome.history.search({
      text: "", // Empty string matches all URLs
      startTime: startTime,
      endTime: endTime,
      maxResults: maxResults + 50, // Fetch slightly more to account for filtering, adjust as needed
    });

    // Filter out visits to the history page itself
    const historyItems = historyItemsRaw.filter((item) => item.url !== historyPageUrl);
    console.log(`Found ${historyItemsRaw.length} raw items, ${historyItems.length} after filtering self.`);

    if (historyItems.length === 0) {
      historyTreeDiv.textContent = "No history found for this period (excluding self).";
      loadingDiv.style.display = "none";
      return;
    }

    // --- 3. Fetch Detailed Visits & Apply Visit-Level Filtering ---
    const allVisitsMap = new Map(); // visitId -> { visitData, historyItem }
    const urlVisitPromises = historyItems.map(async (item) => {
      try {
        const visits = await chrome.history.getVisits({ url: item.url });
        visits.forEach((visit) => {
          // Check time range precisely
          if (visit.visitTime >= startTime && visit.visitTime <= endTime) {
            // Filter out page reloads
            if (visit.transition === "reload") {
              return; // Skip this visit
            }
            // Add to map if not already present (keyed by unique visitId)
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

    // --- 4. Build the Initial Tree Structure ---
    const nodes = {}; // visitId -> node object { id, data, children: [] }
    const rootNodes = []; // Potential root nodes

    // Create node objects for each valid visit
    allVisitsMap.forEach((value, visitId) => {
      nodes[visitId] = {
        id: visitId,
        data: value, // Contains visitData and historyItem
        children: [],
      };
    });

    // Link nodes based on referringVisitId
    allVisitsMap.forEach((value, visitId) => {
      const referringVisitId = value.visitData.referringVisitId;
      const currentNode = nodes[visitId];

      // Check if referrer exists in our collected nodes
      if (referringVisitId && referringVisitId !== "0" && nodes[referringVisitId]) {
        const parentNode = nodes[referringVisitId];
        // Avoid adding duplicates if a child is visited multiple times from the same referrer? (less likely with visitId map)
        // Ensure child isn't already added (though map should prevent duplicate node objects)
        if (!parentNode.children.some((child) => child.id === currentNode.id)) {
          parentNode.children.push(currentNode);
        }
      } else {
        // Treat as a potential root node if no valid referrer found *in this set*
        if (!rootNodes.some((root) => root.id === currentNode.id)) {
          rootNodes.push(currentNode);
        }
      }
    });

    // Refine root nodes: remove any node that ended up being a child of another node in the set
    const nonRootIds = new Set();
    Object.values(nodes).forEach((node) => {
      node.children.forEach((child) => nonRootIds.add(child.id));
    });
    let finalRootNodes = rootNodes.filter((node) => !nonRootIds.has(node.id)); // Use 'let' as it might be modified

    console.log(`Built initial tree structure with ${finalRootNodes.length} potential root nodes.`);

    // --- 5. Apply Consecutive Duplicate Filtering (Optional) ---
    if (shouldFilterDuplicates && finalRootNodes.length > 0) {
      console.log("Filtering consecutive duplicates...");
      // Step 1: Filter children within each root node recursively
      finalRootNodes.forEach((rootNode) => filterConsecutiveDuplicatesInChildren(rootNode));

      // Step 2: Filter the root node list itself for consecutive duplicates
      const rootsToRemoveIndices = new Set();
      // Compare i with i+1 to decide if i should be removed
      for (let i = 0; i < finalRootNodes.length - 1; i++) {
        const currentUrl = finalRootNodes[i]?.data?.historyItem?.url;
        const nextUrl = finalRootNodes[i + 1]?.data?.historyItem?.url;
        if (currentUrl && nextUrl && currentUrl === nextUrl) {
          // Mark CURRENT root for removal to keep the last one
          rootsToRemoveIndices.add(i);
        }
      }

      // Create a new filtered array if modifications are needed
      if (rootsToRemoveIndices.size > 0) {
        const filteredRoots = [];
        for (let i = 0; i < finalRootNodes.length; i++) {
          if (!rootsToRemoveIndices.has(i)) {
            filteredRoots.push(finalRootNodes[i]);
          }
        }
        finalRootNodes = filteredRoots; // Reassign finalRootNodes to the filtered list
      }
      console.log(`Finished filtering duplicates, ${finalRootNodes.length} root nodes remaining.`);
    }

    // --- 6. Render the Tree ---
    console.log(`Rendering ${finalRootNodes.length} final root nodes.`);
    // Ensure tree div is clear before appending
    historyTreeDiv.innerHTML = "";
    if (finalRootNodes.length > 0) {
      // Sort roots by time (most recent first) before rendering
      finalRootNodes.sort((a, b) => b.data.visitData.visitTime - a.data.visitData.visitTime);
      const treeHtml = createTreeHtml(finalRootNodes);
      historyTreeDiv.appendChild(treeHtml);
    } else if (allVisitsMap.size > 0) {
      // This case means visits existed but were all filtered out or couldn't form roots
      historyTreeDiv.textContent = "Could not determine root nodes or all nodes were filtered out.";
    } else {
      // This case means no visits were found after initial filtering
      historyTreeDiv.textContent = "No relevant visits found within the time range (excluding self/reloads).";
    }
  } catch (error) {
    console.error("Error fetching or building history tree:", error);
    historyTreeDiv.textContent = `An error occurred: ${error.message}`;
  } finally {
    loadingDiv.style.display = "none"; // Hide loading indicator
  }
}

// --- Tree Rendering Functions ---

/**
 * Creates the top-level UL element for the history tree.
 * @param {Array} nodes Array of root nodes.
 * @returns {HTMLUListElement} The UL element containing the tree.
 */
function createTreeHtml(nodes) {
  const list = document.createElement("ul");
  list.className = "history-tree-list";
  // Nodes array should already be sorted by time (desc) before calling this
  nodes.forEach((node) => {
    list.appendChild(renderNode(node));
  });
  return list;
}

/**
 * Recursively renders a single node and its children.
 * @param {object} node The node to render.
 * @returns {HTMLLIElement} The LI element representing the node.
 */
function renderNode(node) {
  const listItem = createNodeElement(node.data); // Create the element for the node itself

  if (node.children.length > 0) {
    const childrenList = document.createElement("ul");
    childrenList.className = "history-tree-children";
    // Sort children by time (oldest first within parent) before rendering
    node.children
      .sort((a, b) => a.data.visitData.visitTime - b.data.visitData.visitTime)
      .forEach((childNode) => {
        childrenList.appendChild(renderNode(childNode)); // Recursively render children
      });
    listItem.appendChild(childrenList); // Append children list to the list item
  }
  return listItem;
}

/**
 * Creates a single list item (<li>) element for a history entry.
 * @param {object} nodeData Object containing {visitData, historyItem}.
 * @returns {HTMLLIElement} The formatted LI element.
 */
function createNodeElement(nodeData) {
  const item = nodeData.historyItem;
  const visit = nodeData.visitData;
  const listItem = document.createElement("li");

  // Favicon
  const favicon = document.createElement("img");
  favicon.className = "favicon";
  // Construct the favicon URL using chrome://favicon/ service (requires CSP permission)
  try {
    // Use encodeURIComponent on the *entire* URL passed to chrome://favicon
    favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}`;
  } catch (e) {
    console.warn("Error creating favicon URL for:", item.url, e);
    // Optionally set a default favicon source here
    // favicon.src = 'icons/default_favicon.png';
  }
  favicon.alt = ""; // Decorative
  // Handle favicon loading errors (optional)
  favicon.onerror = () => {
    favicon.style.display = "none"; /* Or set to default */
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
  link.textContent = item.title || item.url; // Display title, fallback to URL
  link.title = item.url; // Show full URL on hover
  link.target = "_blank"; // Open in new tab
  listItem.appendChild(link);

  // Add transition type (optional, but informative)
  const transitionSpan = document.createElement("span");
  transitionSpan.className = "transition";
  transitionSpan.textContent = ` (${visit.transition})`;
  listItem.appendChild(transitionSpan);

  return listItem;
}

// --- Initialization ---

/**
 * Sets default values for the date input fields (e.g., yesterday to today).
 */
function initializeDates() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1); // Set to yesterday

  // Format date as YYYY-MM-DD for input type="date"
  const formatDate = (date) => date.toISOString().split("T")[0];

  if (!startDateInput.value) {
    startDateInput.value = formatDate(yesterday);
  }
  if (!endDateInput.value) {
    endDateInput.value = formatDate(today);
  }
}

// --- Event Listeners ---
refreshButton.addEventListener("click", fetchAndBuildTree);

// Auto-refresh listeners with debounce for text/number inputs
const debouncedFetch = debounce(fetchAndBuildTree, 500); // 500ms delay
maxResultsInput.addEventListener("input", debouncedFetch);

// Use 'change' for date pickers and checkbox as it fires when value is confirmed
startDateInput.addEventListener("change", fetchAndBuildTree);
endDateInput.addEventListener("change", fetchAndBuildTree);
if (filterDuplicatesCheckbox) {
  filterDuplicatesCheckbox.addEventListener("change", fetchAndBuildTree);
}

// --- Initial Load ---
document.addEventListener("DOMContentLoaded", () => {
  initializeDates();
  fetchAndBuildTree(); // Load history when the page is ready
});
