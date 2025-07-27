// In background.js
let storedBookmarks = []; // Maintain a global array in the service worker

// On service worker startup or when needed, load bookmarks
async function loadBookmarksFromStorage() {
    return new Promise(resolve => {
        chrome.storage.local.get('bookmarks', (data) => {
            storedBookmarks = data.bookmarks || [];
            console.log("Bookmarks loaded from storage:", storedBookmarks);
            resolve();
        });
    });
}

// Call this once when the service worker starts or is activated
loadBookmarksFromStorage();

// Listen for messages from the options page
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'indexBookmarks') {
    (async () => {
        await loadBookmarksFromStorage(); // Ensure storedBookmarks is up-to-date
        for (const bookmarkToProcess of request.bookmarks) {
            await indexSingleBookmark(bookmarkToProcess);
        }
        chrome.runtime.sendMessage({ type: 'indexingComplete' });
    })();
    return true; // Indicates that the response will be sent asynchronously
  } else if (request.type === 'deleteBookmarks') {
      (async () => {
          await loadBookmarksFromStorage();
          const initialCount = storedBookmarks.length;
          storedBookmarks = storedBookmarks.filter(bookmark => !request.urls.includes(bookmark.url));
          const deletedCount = initialCount - storedBookmarks.length;
          await saveBookmarksToStorage();
          sendResponse({ success: true, deletedCount: deletedCount });
      })();
      return true; // Indicates that the response will be sent asynchronously
  } else if (request.type === 'updateKeywords') {
      (async () => {
          await loadBookmarksFromStorage();
          const bookmark = storedBookmarks.find(b => b.url === request.url);
          if (bookmark) {
              bookmark.keywords = request.keywords;
              await saveBookmarksToStorage();
              sendResponse({ success: true });
          } else {
              sendResponse({ success: false, error: 'Bookmark not found' });
          }
      })();
      return true; // Indicates that the response will be sent asynchronously
  }
  return true; // Indicates that the response will be sent asynchronously
});

async function indexSingleBookmark(bookmarkToProcess) {
    // Find the actual bookmark object in our storedBookmarks array
    const bookmarkInStorage = storedBookmarks.find(b => b.url === bookmarkToProcess.url);
    if (!bookmarkInStorage) {
        console.warn(`Bookmark not found in storage: ${bookmarkToProcess.url}`);
        return; // Cannot update if not found
    }

    // Update status in the stored array immediately
    bookmarkInStorage.status = 'Indexing...';
    bookmarkInStorage.errorMessage = ''; // Clear previous error
    await saveBookmarksToStorage(); // Save the updated status

    try {
        const response = await fetch(bookmarkInStorage.url, {
            signal: AbortSignal.timeout(10000) // 10-second timeout
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const keywords = extractKeywords(html);

        bookmarkInStorage.status = 'Success';
        bookmarkInStorage.keywords = keywords;
        bookmarkInStorage.errorMessage = '';
    } catch (error) {
        console.error(`Failed to index ${bookmarkInStorage.url}:`, error);
        bookmarkInStorage.status = 'Failed';
        bookmarkInStorage.errorMessage = error.message;
        bookmarkInStorage.keywords = []; // Clear keywords on failure
    } finally {
        await saveBookmarksToStorage(); // Save final status
        // Notify options page about this specific bookmark's update
        chrome.runtime.sendMessage({ type: 'updateBookmarkStatus', bookmark: bookmarkInStorage });
    }
}

async function saveBookmarksToStorage() {
    return new Promise(resolve => {
        chrome.storage.local.set({ bookmarks: storedBookmarks }, resolve);
    });
}

// Extracts keywords from HTML content
function extractKeywords(htmlString) {
  // 1. Extract content within <body> tags
  const bodyMatch = htmlString.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1] : htmlString; // If no body, use full HTML

  // 2. Strip all HTML tags from the body content
  const plainText = bodyContent.replace(/<[^>]+>/g, '').toLowerCase();

  // 3. Existing keyword extraction logic (from previous versions)
  const stopWords = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'did', 'do', 
    'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 
    'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 
    'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
    'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 's', 'same', 'she', 'should', 
    'so', 'some', 'such', 't', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 
    'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 
    'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'you', 'your', 'yours', 
    'yourself', 'yourselves'
  ]);

  const words = plainText.match(/\b\w{3,}\b/g) || []; // Words with 3+ letters
  const filteredWords = words.filter(word => !stopWords.has(word));
  const wordCounts = {};
  for (const word of filteredWords) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }
  const sortedKeywords = Object.keys(wordCounts).sort((a, b) => wordCounts[b] - wordCounts[a]);
  return sortedKeywords.slice(0, 10);
}

// Helper function to escape HTML entities for XML/HTML context
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Omnibox search functionality
chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    await loadBookmarksFromStorage(); // Ensure bookmarks are loaded
    const lowerCaseText = text.toLowerCase();
    console.log(`Omnibox search query: ${lowerCaseText}`);

    const suggestions = storedBookmarks
        .filter(bookmark => {
            const titleMatch = bookmark.title.toLowerCase().includes(lowerCaseText);
            const urlMatch = bookmark.url.toLowerCase().includes(lowerCaseText);
            const keywordMatch = (bookmark.keywords || []).some(kw => {
                const match = kw.toLowerCase().includes(lowerCaseText);
                if (match) {
                    console.log(`Keyword match for '${lowerCaseText}' in bookmark '${bookmark.title}': keyword '${kw}'`);
                }
                return match;
            });
            console.log(`Bookmark: ${bookmark.title}, Keywords: ${bookmark.keywords}, Title Match: ${titleMatch}, URL Match: ${urlMatch}, Keyword Match: ${keywordMatch}`);
            return titleMatch || urlMatch || keywordMatch;
        })
        .slice(0, 10) // Limit to 10 suggestions
        .map(bookmark => {
            const keywordsText = bookmark.keywords && bookmark.keywords.length > 0 ? ` (Keywords: ${escapeHtml(bookmark.keywords.join(', '))})` : '';
            return {
                content: bookmark.url, // This is what gets put into the URL bar
                description: `<url>${escapeHtml(bookmark.title)}</url> - ${escapeHtml(bookmark.url)}${keywordsText}` // Escaped description
            };
        });
    
    console.log("Suggestions being sent to omnibox:", suggestions);
    try {
        suggest(suggestions);
    } catch (e) {
        console.error("Error calling omnibox.suggest:", e);
    }
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    // Open the URL in a new tab, current tab, or background tab based on disposition
    chrome.tabs.create({ url: text });
});