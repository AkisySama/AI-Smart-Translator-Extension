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

  // Check if text is a single word (roughly)
  // A word shouldn't have too many spaces.
  const isWord = text.split(/\s+/).length <= 3 && text.length < 30;

  // Create loading popup
  showPopup(event.pageX, event.pageY, "", true);

  // Send message to background script
  chrome.runtime.sendMessage({ action: "translate", text: text, isWord: isWord }, (response) => {
    if (chrome.runtime.lastError) {
      updatePopup(`<div class="error-msg">Error: ${chrome.runtime.lastError.message}</div>`);
      return;
    }
    
    if (response && response.error) {
      updatePopup(`<div class="error-msg">Error: ${response.error}</div>`);
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
    popupElement.innerHTML = content;
  }
}

function extractJson(str) {
  const match = str.match(/\{[\s\S]*\}/);
  return match ? match[0] : str;
}

function renderWordPopup(data) {
  try {
    const jsonStr = extractJson(data);
    const parsed = JSON.parse(jsonStr);
    const html = `
      <div class="ai-word-card">
        <div class="ai-item"><span class="ai-label">中文意思：</span><span class="ai-val">${parsed.meaning || parsed.中文意思 || ''}</span></div>
        <div class="ai-item"><span class="ai-label">词性：</span><span class="ai-val">${parsed.pos || parsed.词性 || ''}</span></div>
        <div class="ai-item"><span class="ai-label">词根：</span><span class="ai-val">${parsed.root || parsed.词根 || ''}</span></div>
        <div class="ai-item"><span class="ai-label">词根来历：</span><span class="ai-val">${parsed.origin || parsed.词根来历 || parsed.origin_zh || ''}</span></div>
      </div>
    `;
    updatePopup(html);
  } catch (e) {
    updatePopup(`<div class="ai-error">Failed to parse response.<br><br>${data}</div>`);
  }
}

function renderSentencePopup(data) {
  try {
    const jsonStr = extractJson(data);
    const parsed = JSON.parse(jsonStr);
    const html = `
      <div class="ai-sentence-card">
        <div class="ai-item"><span class="ai-label">翻译：</span><span class="ai-val">${parsed.translation || parsed.翻译 || ''}</span></div>
      </div>
    `;
    updatePopup(html);
  } catch (e) {
    updatePopup(`<div class="ai-error">Failed to parse response.<br><br>${data}</div>`);
  }
}
