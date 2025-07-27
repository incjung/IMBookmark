// popup.js (키워드 검색 버그 해결 및 안정성 강화 버전)

document.addEventListener('DOMContentLoaded', async () => {
    // UI 요소 가져오기
    const welcomeScreen = document.getElementById('welcomeScreen');
    const mainContent = document.getElementById('mainContent');
    const startButton = document.getElementById('startButton');
    const loadingMessage = document.getElementById('loadingMessage');

    // 스토리지에서 초기화 상태 확인
    const { isInitialized } = await chrome.storage.local.get('isInitialized');

    if (isInitialized) {
        showMainContent();
    } else {
        showWelcomeScreen();
    }

    function showWelcomeScreen() {
        welcomeScreen.style.display = 'block';
        mainContent.style.display = 'none';
        startButton.addEventListener('click', handleStartButtonClick, { once: true }); // 이벤트 리스너 중복 방지
    }

    function showMainContent() {
        welcomeScreen.style.display = 'none';
        mainContent.style.display = 'block';
        initializeMainContent();
    }

    function handleStartButtonClick() {
        startButton.disabled = true;
        loadingMessage.style.display = 'block';
        chrome.runtime.sendMessage({ action: 'startInitialProcessing' }, (response) => {
            if (response && response.status === 'completed') {
                showMainContent();
            } else {
                loadingMessage.textContent = "오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
            }
        });
    }

    // --- 메인 검색 화면 로직 ---
    function initializeMainContent() {
        const searchInput = document.getElementById('searchInput');
        const resultsList = document.getElementById('resultsList');
        const resultCount = document.getElementById('resultCount');
        const openSelectedButton = document.getElementById('openSelectedButton');
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const refreshButton = document.getElementById('refreshButton');
        const messageArea = document.getElementById('messageArea');

        let allBookmarks = {};

        async function loadAndDisplayBookmarks() {
            const data = await chrome.storage.local.get('bookmarks');
            allBookmarks = data.bookmarks || {};
            if (Object.keys(allBookmarks).length > 0) {
                messageArea.style.display = 'none';
            } else {
                messageArea.textContent = '북마크 데이터가 없습니다. 새로고침 버튼(🔄)을 눌러 동기화해주세요.';
            }
            filterAndRender(searchInput.value); // 현재 검색어 유지하며 렌더링
            searchInput.focus();
        }

        function filterAndRender(query) {
            const lowerCaseQuery = query.toLowerCase();
            resultsList.innerHTML = '';
            
            // ★★★★★ 키워드 검색 버그를 해결한 핵심 수정 부분 ★★★★★
            const filteredEntries = Object.entries(allBookmarks).filter(([url, bookmark]) => {
                // bookmark 객체 자체가 유효한지 먼저 확인
                if (!bookmark) return false;

                const titleMatch = (bookmark.title || '').toLowerCase().includes(lowerCaseQuery);
                
                // bookmark.keywords가 배열인 경우에만 .some()을 호출하도록 방어 코드 추가
                const keywordMatch = Array.isArray(bookmark.keywords) && 
                                     bookmark.keywords.some(k => (k || '').toLowerCase().includes(lowerCaseQuery));

                return titleMatch || keywordMatch;
            });

            if (filteredEntries.length === 0) {
                messageArea.style.display = 'block';
                messageArea.textContent = query ? '일치하는 결과가 없습니다.' : '저장된 북마크가 없습니다.';
            } else {
                messageArea.style.display = 'none';
            }
            
            filteredEntries.forEach(([url, bookmark]) => {
                const listItem = document.createElement('li');
                listItem.dataset.url = url;
                const keywordsText = (bookmark.keywords || []).join(', ');
                const highlightedKeywords = (bookmark.keywords || []).map(k => (k || '').toLowerCase().includes(lowerCaseQuery) && lowerCaseQuery ? `<b>${k}</b>` : k).join(', ');
                listItem.innerHTML = `<input type="checkbox" title="선택/해제"><div class="content"><span class="title" title="${bookmark.title}">${bookmark.title || '제목 없음'}</span><span class="keywords" title="키워드: ${keywordsText}">키워드: ${highlightedKeywords}</span></div>`;
                resultsList.appendChild(listItem);
            });

            resultCount.textContent = `결과: ${filteredEntries.length}개`;
            updateUIStates();
        }
        
        function updateUIStates() {
            const allCheckboxes = resultsList.querySelectorAll('input[type="checkbox"]');
            const checkedCount = Array.from(allCheckboxes).filter(cb => cb.checked).length;
            openSelectedButton.disabled = checkedCount === 0;
            openSelectedButton.textContent = checkedCount > 0 ? `${checkedCount}개 탭 열기` : '선택한 북마크 열기';
            selectAllCheckbox.checked = allCheckboxes.length > 0 && checkedCount === allCheckboxes.length;
            selectAllCheckbox.disabled = allCheckboxes.length === 0;
        }

        searchInput.addEventListener('input', () => filterAndRender(searchInput.value));
        resultsList.addEventListener('click', (e) => {
            if (e.target.tagName !== 'INPUT') {
                const li = e.target.closest('li');
                if (li) {
                    li.querySelector('input[type="checkbox"]').checked = !li.querySelector('input[type="checkbox"]').checked;
                    updateUIStates();
                }
            }
        });
        resultsList.addEventListener('change', updateUIStates);
        selectAllCheckbox.addEventListener('change', () => {
            resultsList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = selectAllCheckbox.checked);
            updateUIStates();
        });
        openSelectedButton.addEventListener('click', () => {
            resultsList.querySelectorAll('input[type="checkbox"]:checked').forEach(checkbox => {
                const url = checkbox.closest('li').dataset.url;
                if (url) chrome.tabs.create({ url });
            });
        });
        refreshButton.addEventListener('click', () => {
            if (refreshButton.classList.contains('loading')) return;
            refreshButton.classList.add('loading');
            resultCount.textContent = "동기화 중...";
            chrome.runtime.sendMessage({ action: 'refreshBookmarks' }, (response) => {
                setTimeout(() => {
                    refreshButton.classList.remove('loading');
                    loadAndDisplayBookmarks();
                }, 500);
            });
        });

        loadAndDisplayBookmarks();
    }
});
