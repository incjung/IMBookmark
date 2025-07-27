
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('search');
  const resultsList = document.getElementById('results');
  const resultsCount = document.getElementById('results-count');
  const openSelectedBtn = document.getElementById('open-selected-btn');

  function searchBookmarks(term) {
    chrome.storage.local.get('bookmarks', (data) => {
      if (!data.bookmarks) {
        resultsList.innerHTML = '<li>Please import bookmarks from the options page.</li>';
        resultsCount.textContent = '';
        openSelectedBtn.style.display = 'none';
        return;
      }

      const lowerCaseTerm = term.toLowerCase();
      const filteredBookmarks = data.bookmarks.filter(bookmark => {
        const titleMatch = bookmark.title.toLowerCase().includes(lowerCaseTerm);
        const urlMatch = bookmark.url.toLowerCase().includes(lowerCaseTerm);
        const keywordMatch = (bookmark.keywords || []).some(kw => kw.toLowerCase().includes(lowerCaseTerm));
        return titleMatch || urlMatch || keywordMatch;
      });

      resultsList.innerHTML = '';
      resultsCount.textContent = `${filteredBookmarks.length} results found`;

      if (filteredBookmarks.length > 0) {
        openSelectedBtn.style.display = 'block';
        filteredBookmarks.forEach(bookmark => {
          const li = document.createElement('li');
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'bookmark-checkbox'; // Add class for easier selection
          checkbox.dataset.url = bookmark.url;
          li.appendChild(checkbox);

          const a = document.createElement('a');
          a.href = bookmark.url;
          a.textContent = bookmark.title;
          a.target = '_blank';
          li.appendChild(a);

          resultsList.appendChild(li);
        });
      } else {
        openSelectedBtn.style.display = 'none';
        resultsList.innerHTML = '<li>No matching bookmarks found.</li>';
      }
    });
  }

  searchInput.addEventListener('input', (e) => {
    searchBookmarks(e.target.value);
  });

  openSelectedBtn.addEventListener('click', () => {
    const selectedCheckboxes = document.querySelectorAll('.bookmark-checkbox:checked');
    selectedCheckboxes.forEach(checkbox => {
      chrome.tabs.create({ url: checkbox.dataset.url, active: false });
    });
  });

  // Initial search when popup opens
  searchBookmarks(searchInput.value);
});
