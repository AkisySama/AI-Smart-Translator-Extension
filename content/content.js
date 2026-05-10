let popupElement = null;

document.addEventListener('mouseup', (event) => {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  // If clicked inside our popup, do nothing
  if (popupElement && popupElement.contains(event.target)) {
    return;
  }
  
  // Remove existing popup if clicked outside or selection is empty
  if (popupElement) {
    popupElement.remove();
    popupElement = null;
  }

  if (!text) {
    return;
  }

  // If the selected text is purely numeric (including decimals, negatives, percentages, etc.), do nothing
  if (/^[-+]?[\d,]*\.?\d+%?$/.test(text)) {
    return;
  }

  // If the selected text contains Chinese characters, do nothing
  const chineseCharCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
  if (chineseCharCount / text.length > 0.2) {
    return;
  }

  // If the selected text is a URL, do nothing
  if (/^(https?:\/\/|ftp:\/\/|www\.)\S+$/i.test(text) ||
      /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(\/\S*)?$/i.test(text)) {
    return;
  }

  // Check if text is a single word (roughly)
  // A word shouldn't have too many spaces.
  const isWord = text.split(/\s+/).length <= 3 && text.length < 30;

  // Create loading popup
  showPopup(event.pageX, event.pageY, "", true);

  // Send message to background script
  chrome.runtime.sendMessage({ action: "translate", text: text, isWord: isWord }, (response) => {
    if (chrome.runtime.lastError) {
      updatePopupError(chrome.runtime.lastError.message);
      return;
    }
    
    if (response && response.error) {
      updatePopupError(response.error);
      return;
    }

    if (isWord) {
      renderWordPopup(response.data);
    } else {
      renderSentencePopup(response.data);
    }
  });
});

document.addEventListener('mousedown', (event) => {
  if (popupElement && !popupElement.contains(event.target)) {
    popupElement.remove();
    popupElement = null;
  }
});

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
    div.className = 'error-msg';
    div.textContent = 'Error: ' + message;
    popupElement.appendChild(div);
  }
}

function extractJson(str) {
  const match = str.match(/\{[\s\S]*\}/);
  return match ? match[0] : str;
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

function renderWordPopup(data) {
  try {
    const jsonStr = extractJson(data);
    const parsed = JSON.parse(jsonStr);
    const card = document.createElement('div');
    card.className = 'ai-word-card';
    card.appendChild(createItem('中文意思：', parsed.meaning || parsed.中文意思 || ''));
    card.appendChild(createItem('词性：', parsed.pos || parsed.词性 || ''));
    card.appendChild(createItem('词根：', parsed.root || parsed.词根 || ''));
    card.appendChild(createItem('词根来历：', parsed.origin || parsed.词根来历 || parsed.origin_zh || ''));
    updatePopup(card);
  } catch (e) {
    const errDiv = document.createElement('div');
    errDiv.className = 'ai-error';
    errDiv.textContent = 'Failed to parse response: ' + data;
    updatePopup(errDiv);
  }
}

function renderSentencePopup(data) {
  try {
    const jsonStr = extractJson(data);
    const parsed = JSON.parse(jsonStr);
    const card = document.createElement('div');
    card.className = 'ai-sentence-card';
    card.appendChild(createItem('翻译：', parsed.translation || parsed.翻译 || ''));
    updatePopup(card);
  } catch (e) {
    const errDiv = document.createElement('div');
    errDiv.className = 'ai-error';
    errDiv.textContent = 'Failed to parse response: ' + data;
    updatePopup(errDiv);
  }
}
