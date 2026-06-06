let popupElement = null;
let triggerIconElement = null;
let selectionAtMouseDown = '';

// Variables to store current selection info for delayed translation lookup
let currentSelectionText = '';
let currentIsWord = false;
let mouseX = 0;
let mouseY = 0;

document.addEventListener('mouseup', (event) => {
  const selection = window.getSelection();
  const text = selection.toString().trim();

  // If clicked inside our popup or trigger icon, do nothing
  if ((popupElement && popupElement.contains(event.target)) || 
      (triggerIconElement && triggerIconElement.contains(event.target))) {
    return;
  }

  // Remove existing elements if clicked outside or selection is empty
  removePopup();
  removeTriggerIcon();

  if (!text) {
    return;
  }

  // If selection hasn't changed since mousedown, this click didn't create a new selection — don't show popup
  if (text === selectionAtMouseDown) {
    return;
  }

  // If the selected text is purely numeric (including decimals, negatives, percentages, etc.), do nothing
  if (/^[-+]?[\d,]*\.?\d+%?$/.test(text)) {
    return;
  }

  // If the selected text contains Chinese characters, do nothing
  const chineseCharCount = (text.match(/\p{Script=Han}/gu) || []).length;
  if (chineseCharCount / text.length > 0.2) {
    return;
  }

  // If the selected text is a URL, do nothing
  if (/^(https?:\/\/|ftp:\/\/|www\.)\S+$/i.test(text) ||
      /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/\S*)?$/i.test(text)) {
    return;
  }

  // If text doesn't contain enough Latin letters, it's unlikely to be English
  const latinCharCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (latinCharCount / text.length < 0.3) {
    return;
  }

  // Check if text is a single word (roughly)
  // A word shouldn't have too many spaces.
  const isWord = text.split(/\s+/).length <= 3 && text.length < 30;

  // Save selection details
  currentSelectionText = text;
  currentIsWord = isWord;
  mouseX = event.pageX;
  mouseY = event.pageY;

  // Show floating trigger icon
  showTriggerIcon(mouseX, mouseY);
});

document.addEventListener('mousedown', (event) => {
  selectionAtMouseDown = window.getSelection().toString().trim();
  
  // If clicking outside popup, remove it
  if (popupElement && !popupElement.contains(event.target)) {
    removePopup();
  }
  
  // If clicking outside trigger icon, remove it
  if (triggerIconElement && !triggerIconElement.contains(event.target)) {
    removeTriggerIcon();
  }
});

function showTriggerIcon(x, y) {
  triggerIconElement = document.createElement('div');
  triggerIconElement.className = 'ai-translator-trigger-icon';
  
  // Lucide Languages Icon SVG
  triggerIconElement.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="m5 8 6 6"/>
      <path d="m4 14 6-6"/>
      <path d="M2 5h12"/>
      <path d="M7 2h1"/>
      <path d="m22 22-5-10-5 10"/>
      <path d="M14 18h6"/>
    </svg>
  `;

  // Position slightly offset to bottom right from cursor
  triggerIconElement.style.left = `${x + 10}px`;
  triggerIconElement.style.top = `${y + 10}px`;

  triggerIconElement.addEventListener('click', (e) => {
    e.stopPropagation();
    const selectedText = currentSelectionText;
    const isWord = currentIsWord;
    
    // Create loading popup at the saved position
    showPopup(mouseX, mouseY, "", true);
    
    // Remove the trigger icon since translation is initiated
    removeTriggerIcon();

    // Send message to background script
    chrome.runtime.sendMessage({ action: "translate", text: selectedText, isWord }, (response) => {
      if (chrome.runtime.lastError) {
        updatePopupError(chrome.runtime.lastError.message);
        return;
      }

      if (response && response.error) {
        updatePopupError(response.error);
        return;
      }

      if (!response || !response.data || typeof response.data !== 'object') {
        updatePopupError('AI 返回的数据格式异常，请重试。');
        return;
      }

      if (response.data.type === 'word') {
        renderWordPopup(response.data, selectedText);
      } else if (response.data.type === 'sentence') {
        renderSentencePopup(response.data);
      } else {
        updatePopupError('AI 返回了未知的结果类型，请重试。');
      }
    });
  });

  document.body.appendChild(triggerIconElement);
}

function removeTriggerIcon() {
  if (triggerIconElement) {
    triggerIconElement.remove();
    triggerIconElement = null;
  }
}

function removePopup() {
  if (popupElement) {
    popupElement.remove();
    popupElement = null;
  }
}

function showPopup(x, y, content, isLoading = false) {
  popupElement = document.createElement('div');
  popupElement.className = 'ai-translator-popup';
  popupElement.style.left = `${x}px`;
  popupElement.style.top = `${y + 15}px`;

  if (isLoading) {
    popupElement.innerHTML = `
      <div class="ai-translator-loading">
        <div class="spinner"></div>
        <span>AI is thinking...</span>
      </div>`;
  } else {
    popupElement.innerHTML = content;
  }

  document.body.appendChild(popupElement);

  // Adjust position if it goes off screen
  const rect = popupElement.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    // If it goes off the right edge of the viewport
    popupElement.style.left = `${window.innerWidth - rect.width - 10 + window.scrollX}px`;
  }
  if (rect.bottom > window.innerHeight) {
    // If it goes off the bottom edge, place it above the cursor
    popupElement.style.top = `${y - rect.height - 15}px`;
  }
}

function updatePopup(content) {
  if (popupElement) {
    popupElement.innerHTML = '';
    popupElement.appendChild(content);
  }
}

function updatePopupError(message) {
  if (popupElement) {
    popupElement.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'ai-error';
    div.textContent = message;
    popupElement.appendChild(div);
  }
}

function speakWord(word) {
  if (!window.speechSynthesis) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  utterance.rate = 0.9;

  // Prefer an English voice if available
  const voices = speechSynthesis.getVoices();
  const enVoice = voices.find(v => v.lang.startsWith('en'));
  if (enVoice) utterance.voice = enVoice;

  speechSynthesis.speak(utterance);
}

function createSpeakerButton(word) {
  const btn = document.createElement('button');
  btn.className = 'ai-speaker-btn';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>
  `;
  btn.title = '朗读发音';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    speakWord(word);
  });
  return btn;
}

function createItem(label, value) {
  const div = document.createElement('div');
  div.className = 'ai-item';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'ai-label';
  labelSpan.textContent = label;
  const valSpan = document.createElement('span');
  valSpan.className = 'ai-val';
  valSpan.textContent = value || '';
  div.appendChild(labelSpan);
  div.appendChild(valSpan);
  return div;
}

function renderWordPopup(data, word) {
  const card = document.createElement('div');
  card.className = 'ai-word-card';

  // Word header with speaker button
  const wordHeader = document.createElement('div');
  wordHeader.className = 'ai-word-header';
  const wordSpan = document.createElement('span');
  wordSpan.className = 'ai-word-text';
  wordSpan.textContent = word;
  wordHeader.appendChild(wordSpan);
  wordHeader.appendChild(createSpeakerButton(word));
  card.appendChild(wordHeader);

  card.appendChild(createItem('中文意思：', data.meaning));
  card.appendChild(createItem('词性：', data.pos));
  card.appendChild(createItem('词根：', data.root));
  card.appendChild(createItem('词根来历：', data.origin));
  updatePopup(card);
}

function renderSentencePopup(data) {
  const card = document.createElement('div');
  card.className = 'ai-sentence-card';
  card.appendChild(createItem('翻译：', data.translation));
  updatePopup(card);
}
