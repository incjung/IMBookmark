// background.js (업데이트 시 자동 동기화 기능 추가)

console.log("Service Worker: 스크립트 파일 로드 및 리스너 등록 시작.");

const STOP_WORDS = new Set(['a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'who', 'will', 'with']);

try {
  // ★★★ 변경된 부분: 설치/업데이트 시 동작 개선 ★★★
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      // 최초 설치 시
      console.log("확장 프로그램 최초 설치. 초기화 대기.");
      chrome.storage.local.set({ isInitialized: false, bookmarks: {} });
    } else if (details.reason === 'update') {
      // 업데이트 시 (크롬 재시작 포함)
      console.log("확장 프로그램 업데이트 감지. 스마트 동기화를 수행합니다.");
      processAllBookmarks();
    }
  });

  // ... (이하 onMessage, onCreated 등 다른 리스너는 이전과 동일)
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'startInitialProcessing' || request.action === 'refreshBookmarks') {
      processAllBookmarks().then(() => {
        if (request.action === 'startInitialProcessing') {
          chrome.storage.local.set({ isInitialized: true });
        }
        sendResponse({ status: 'completed' });
      });
      return true;
    }
  });
  
  chrome.bookmarks.onCreated.addListener((id, bookmark) => {
    if (bookmark && bookmark.url) processSingleBookmark(bookmark);
  });
  
  chrome.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
    if (removeInfo && removeInfo.node && removeInfo.node.url) {
      const url = removeInfo.node.url;
      const { bookmarks } = await chrome.storage.local.get('bookmarks');
      if (bookmarks && bookmarks[url]) {
        delete bookmarks[url];
        await chrome.storage.local.set({ bookmarks });
      }
    }
  });
  
  chrome.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    const bookmarkNode = (await chrome.bookmarks.get(id))[0];
    if (bookmarkNode && bookmarkNode.url) processSingleBookmark(bookmarkNode);
  });
  
  chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
    const { bookmarks } = await chrome.storage.local.get('bookmarks');
    if (!text || !bookmarks) return;
    const lowerCaseQuery = text.toLowerCase();
    const suggestions = [];
    for (const url in bookmarks) {
      const bookmark = bookmarks[url];
      if (bookmark && (bookmark.title || '').toLowerCase().includes(lowerCaseQuery) || (Array.isArray(bookmark.keywords) && bookmark.keywords.some(k=>(k||'').toLowerCase().includes(lowerCaseQuery)))) {
        suggestions.push({
            content: url,
            description: `${escapeXml(bookmark.title)} - <url>${escapeXml(url)}</url> <dim>(${escapeXml((bookmark.keywords || []).join(', '))})</dim>`
        });
      }
    }
    suggest(suggestions.slice(0, 6));
  });

  chrome.omnibox.onInputEntered.addListener((url) => {
    if (url) chrome.tabs.create({ url });
  });

} catch (e) {
  console.error("Service Worker 리스너 등록 중 치명적 오류 발생:", e);
}


// --- 핵심 함수 및 유틸리티 함수 ---
// (이 아래의 모든 함수는 이전 버전과 동일하게 유지)

async function processAllBookmarks() {
  console.log("스마트 동기화를 시작합니다...");
  const chromeBookmarkTree = await chrome.bookmarks.getTree();
  const chromeBookmarks = flattenBookmarkTree(chromeBookmarkTree);
  const chromeUrlSet = new Set(chromeBookmarks.map(b => b.url));
  const { bookmarks: indexedData = {} } = await chrome.storage.local.get('bookmarks');
  const indexedUrlSet = new Set(Object.keys(indexedData));
  let deletedCount = 0;
  for (const url of indexedUrlSet) {
    if (!chromeUrlSet.has(url)) {
      delete indexedData[url];
      deletedCount++;
    }
  }
  if(deletedCount > 0) console.log(`${deletedCount}개의 삭제된 북마크를 인덱스에서 제거했습니다.`);
  let addedCount = 0;
  for (const bookmark of chromeBookmarks) {
    if (isValidUrl(bookmark.url)) {
      if (!indexedData[bookmark.url] || indexedData[bookmark.url].title !== (bookmark.title || '')) {
        if(!indexedData[bookmark.url]) addedCount++;
        indexedData[bookmark.url] = {
          title: bookmark.title || '',
          keywords: await extractKeywords(bookmark.url)
        };
      }
    }
  }
  if(addedCount > 0) console.log(`${addedCount}개의 새로운 북마크를 인덱싱했습니다.`);
  await chrome.storage.local.set({ bookmarks: indexedData });
  console.log(`스마트 동기화 완료. 총 ${Object.keys(indexedData).length}개의 북마크가 인덱싱되었습니다.`);
}

async function processSingleBookmark(bookmark) {
  const { isInitialized } = await chrome.storage.local.get('isInitialized');
  if (!isInitialized) return;
  if (!isValidUrl(bookmark.url)) return;
  const { bookmarks } = await chrome.storage.local.get('bookmarks');
  const data = bookmarks || {};
  data[bookmark.url] = {
    title: bookmark.title || '',
    keywords: await extractKeywords(bookmark.url)
  };
  await chrome.storage.local.set({ bookmarks: data });
}

async function extractKeywords(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const title = doc.querySelector('title')?.innerText || '';
      const description = doc.querySelector('meta[name="description"]')?.content || '';
      const h1s = Array.from(doc.querySelectorAll('h1')).map(h => h.innerText).join(' ');
      const textContent = `${title} ${description} ${h1s}`;
      const words = textContent.toLowerCase().match(/\b(\w{3,15})\b/g) || [];
      const uniqueKeywords = [...new Set(words.filter(word => !STOP_WORDS.has(word)))];
      return uniqueKeywords.slice(0, 10);
    } else {
      const type = contentType.split('/')[1]?.split(';')[0] || 'file';
      return [type.toUpperCase()];
    }
  } catch (error) {
    return ['추출 실패'];
  }
}

function flattenBookmarkTree(nodes) {
  const bookmarks = [];
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.url) bookmarks.push({ title: node.title, url: node.url });
    if (node.children) stack.push(...node.children);
  }
  return bookmarks;
}

function isValidUrl(url) {
  return typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'));
}

function escapeXml(str) {
  // 입력값이 문자열이 아니면 에러 방지를 위해 빈 문자열 반환
  if (typeof str !== 'string') {
    return '';
  }
    
    // 특수 문자를 HTML 엔티티로 변환
    return str.replace(/[<>&'"]/g, c => {
	switch (c) {
	case '<':
	    return '&lt;'; // HTML entity for '<'
	case '>':
	    return '&gt;'; // HTML entity for '>'
	case '&':
	    return '&amp;'; // HTML entity for '&'
	case '\'':
	    return '&#39;'; // HTML entity for single quote
	case '"':
	    return '&quot;'; // HTML entity for double quote
	}
	
    });
}
console.log("Service Worker: 스크립트 파일의 모든 코드가 성공적으로 해석되었습니다.");
