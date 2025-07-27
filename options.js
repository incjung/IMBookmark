document.addEventListener('DOMContentLoaded', () => {
    const importBtn = document.getElementById('import-btn');
    const indexSelectedBtn = document.getElementById('index-selected-btn');
    const exportDataBtn = document.getElementById('export-data-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const selectAllCheckbox = document.getElementById('select-all');
    const bookmarksTableBody = document.querySelector('#bookmarks-table tbody');
    const totalBookmarksCountSpan = document.getElementById('total-bookmarks-count');

    let displayedBookmarks = [];

    function displayBookmarks(bookmarks) {
        bookmarksTableBody.innerHTML = '';
        displayedBookmarks = bookmarks;
        totalBookmarksCountSpan.textContent = bookmarks.length;

        bookmarks.forEach((bookmark, index) => {
            const statusText = bookmark.status === 'Failed' && bookmark.errorMessage 
                               ? `Failed: ${bookmark.errorMessage}` 
                               : bookmark.status || 'Not Indexed';
            const row = document.createElement('tr');
            row.innerHTML = `
              <td>${index + 1}</td>
              <td><input type="checkbox" class="bookmark-checkbox" data-index="${index}"></td>
              <td>${bookmark.title}</td>
              <td><a href="${bookmark.url}" target="_blank">${bookmark.url}</a></td>
              <td class="status">${statusText}</td>
              <td class="keywords-cell" contenteditable="true" data-url="${bookmark.url}">${(bookmark.keywords || []).join(', ')}</td>
            `;
            bookmarksTableBody.appendChild(row);
        });

        // Add event listeners for editable keyword cells
        document.querySelectorAll('.keywords-cell').forEach(cell => {
            cell.addEventListener('blur', (event) => {
                const url = event.target.dataset.url;
                const newKeywords = event.target.textContent.split(',').map(kw => kw.trim()).filter(kw => kw.length > 0);
                chrome.runtime.sendMessage({ type: 'updateKeywords', url: url, keywords: newKeywords });
            });
            cell.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault(); // Prevent new line
                    event.target.blur(); // Trigger blur to save changes
                }
            });
        });
    }

    importBtn.addEventListener('click', () => {
        chrome.bookmarks.getTree((bookmarkTree) => {
            const bookmarks = [];
            function traverse(nodes) {
                for (const node of nodes) {
                    if (node.url && (node.url.startsWith('http:') || node.url.startsWith('https://'))) {
                        bookmarks.push({ title: node.title, url: node.url, status: 'Not Indexed', keywords: [] });
                    }
                    if (node.children) {
                        traverse(node.children);
                    }
                }
            }
            traverse(bookmarkTree);
            chrome.storage.local.set({ 'bookmarks': bookmarks }, () => {
                displayBookmarks(bookmarks);
                alert(`${bookmarks.length} bookmarks imported successfully!`);
            });
        });
    });

    indexSelectedBtn.addEventListener('click', () => {
        const bookmarksToIndex = [];
        document.querySelectorAll('.bookmark-checkbox:checked').forEach(checkbox => {
            bookmarksToIndex.push(displayedBookmarks[checkbox.dataset.index]);
        });

        if (bookmarksToIndex.length > 0) {
            indexSelectedBtn.disabled = true;
            importBtn.disabled = true;
            exportDataBtn.disabled = true;
            deleteSelectedBtn.disabled = true;
            chrome.runtime.sendMessage({ type: 'indexBookmarks', bookmarks: bookmarksToIndex });
        } else {
            alert('Please select at least one bookmark to index.');
        }
    });

    exportDataBtn.addEventListener('click', () => {
        chrome.storage.local.get('bookmarks', (data) => {
            const bookmarks = data.bookmarks || [];
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(bookmarks, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `bookmark_data_${Date.now()}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
            alert('Bookmark data exported successfully!');
        });
    });

    deleteSelectedBtn.addEventListener('click', () => {
        const selectedUrls = [];
        document.querySelectorAll('.bookmark-checkbox:checked').forEach(checkbox => {
            selectedUrls.push(displayedBookmarks[checkbox.dataset.index].url);
        });

        if (selectedUrls.length > 0) {
            if (confirm(`Are you sure you want to delete ${selectedUrls.length} selected bookmark(s)?`)) {
                chrome.runtime.sendMessage({ type: 'deleteBookmarks', urls: selectedUrls }, (response) => {
                    if (response && response.success) {
                        alert(`${response.deletedCount} bookmark(s) deleted successfully.`);
                        // Reload bookmarks after deletion
                        chrome.storage.local.get('bookmarks', (data) => {
                            displayBookmarks(data.bookmarks || []);
                        });
                    } else {
                        alert('Failed to delete bookmarks.');
                    }
                });
            }
        } else {
            alert('Please select at least one bookmark to delete.');
        }
    });

    selectAllCheckbox.addEventListener('change', () => {
        document.querySelectorAll('.bookmark-checkbox').forEach(checkbox => {
            checkbox.checked = selectAllCheckbox.checked;
        });
    });

    // Removed retry button event listener

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type === 'updateBookmarkStatus') {
            const bookmarkIndex = displayedBookmarks.findIndex(b => b.url === request.bookmark.url);
            if (bookmarkIndex !== -1) {
                displayedBookmarks[bookmarkIndex] = request.bookmark;
                const row = bookmarksTableBody.querySelector(`tr:nth-child(${bookmarkIndex + 1})`);
                if(row) {
                    const statusCell = row.querySelector('.status');
                    statusCell.textContent = request.bookmark.status === 'Failed' && request.bookmark.errorMessage 
                                            ? `Failed: ${request.bookmark.errorMessage}` 
                                            : request.bookmark.status;
                    row.querySelector('.keywords-cell').textContent = (request.bookmark.keywords || []).join(', ');
                }
            }
        } else if (request.type === 'indexingComplete') {
            indexSelectedBtn.disabled = false;
            importBtn.disabled = false;
            exportDataBtn.disabled = false;
            deleteSelectedBtn.disabled = false;
            alert('Finished indexing selected bookmarks!');
        }
    });

    // Load bookmarks from storage on initial load
    chrome.storage.local.get('bookmarks', (data) => {
        if (data.bookmarks) {
            displayBookmarks(data.bookmarks);
        }
    });
});