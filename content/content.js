let popupElement = null;
const popupElements = new Set();
let triggerIconElement = null;
let activeTranslationPort = null;
let popupView = null;
let typewriterQueue = Promise.resolve();
let selectionAtMouseDown = '';
let popupDragState = null;

const POPUP_PIN_MODE_NONE = 'none';
const POPUP_PIN_MODE_VIEWPORT = 'viewport';
const POPUP_PIN_MODE_PAGE = 'page';
const THINKING_ORB_STATE = 'composing';

// Variables to store current selection info for delayed translation lookup
let currentSelectionText = '';
let currentIsWord = false;
let mouseX = 0;
let mouseY = 0;

document.addEventListener('mouseup', (event) => {
  if (popupDragState) {
    stopPopupDrag();
    return;
  }

  const selection = window.getSelection();
  const text = selection.toString().trim();

  // If clicked inside our popup or trigger icon, do nothing
  if (isInsideAnyPopup(event.target) ||
      (triggerIconElement && triggerIconElement.contains(event.target))) {
    return;
  }

  // Remove existing elements if clicked outside or selection is empty
  removeUnpinnedPopups();
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
  if (!isInsideAnyPopup(event.target)) removeUnpinnedPopups();
  
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
    showPopup(mouseX, mouseY, "", true, isWord);
    
    // Remove the trigger icon since translation is initiated
    removeTriggerIcon();

    if (activeTranslationPort) {
      disconnectTranslationPort(activeTranslationPort);
      activeTranslationPort = null;
    }

    const port = connectTranslationStream();
    if (!port) return;

    activeTranslationPort = port;

    port.onMessage.addListener((message) => {
      if (port !== activeTranslationPort) return;

      if (message.type === 'error') {
        updatePopupError(message.error);
        activeTranslationPort = null;
        disconnectTranslationPort(port);
        return;
      }

      if (!message.data || typeof message.data !== 'object') {
        updatePopupError('AI 返回的数据格式异常，请重试。');
        return;
      }

      if (message.data.type === 'word') {
        renderWordPopup(message.data, selectedText);
      } else if (message.data.type === 'sentence') {
        renderSentencePopup(message.data);
      } else {
        updatePopupError('AI 返回了未知的结果类型，请重试。');
      }

      if (message.type === 'result') {
        activeTranslationPort = null;
        disconnectTranslationPort(port);
      }
    });

    port.onDisconnect.addListener(() => {
      if (port !== activeTranslationPort) return;
      activeTranslationPort = null;
      const message = globalThis.chrome?.runtime?.lastError?.message;
      updatePopupError(message || '流式连接已中断，请重试。');
    });

    try {
      port.postMessage({ action: 'translate', text: selectedText, isWord });
    } catch (error) {
      if (port !== activeTranslationPort) return;
      activeTranslationPort = null;
      updatePopupError('扩展连接已失效，请刷新页面后重试。');
    }
  });

  document.body.appendChild(triggerIconElement);
}

function removeTriggerIcon() {
  if (triggerIconElement) {
    triggerIconElement.remove();
    triggerIconElement = null;
  }
}

function disconnectTranslationPort(port) {
  try {
    port?.disconnect();
  } catch (error) {
    // The extension context may already have been invalidated.
  }
}

function connectTranslationStream() {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime || typeof runtime.connect !== 'function') {
    updatePopupError('扩展连接已失效，请刷新页面后重试。');
    return null;
  }

  try {
    return runtime.connect({ name: 'translation-stream' });
  } catch (error) {
    updatePopupError('扩展连接已失效，请刷新页面后重试。');
    return null;
  }
}

function getPopupPinMode(element) {
  return element?.dataset.pinMode || POPUP_PIN_MODE_NONE;
}

function isPopupPinned(element) {
  return getPopupPinMode(element) !== POPUP_PIN_MODE_NONE;
}

function isInsideAnyPopup(target) {
  return [...popupElements].some((element) => element.contains(target));
}

function removePopup(target = popupElement, force = false) {
  if (!target || (!force && isPopupPinned(target))) return;

  stopPopupDrag(target);
  popupElements.delete(target);
  target._sizeObserver?.disconnect();
  stopLoadingIndicator(target);
  target._relatedPorts?.forEach(disconnectTranslationPort);
  target.remove();

  if (target === popupElement) {
    popupElement = null;
    resetPopupView();
  }
}

function removeUnpinnedPopups() {
  [...popupElements].forEach((element) => {
    if (!isPopupPinned(element)) removePopup(element);
  });
}

function getPinButtonTitle(mode) {
  if (mode === POPUP_PIN_MODE_VIEWPORT) return '改为随页面滚动';
  if (mode === POPUP_PIN_MODE_PAGE) return '取消固定窗口';
  return '固定在屏幕';
}

function syncPinButton(element) {
  const pinButtons = element?.querySelectorAll('.ai-pin-btn');
  if (!pinButtons) return;
  pinButtons.forEach((pinButton) => {

  const mode = getPopupPinMode(element);
  const title = getPinButtonTitle(mode);
  pinButton.dataset.pinMode = mode;
  pinButton.setAttribute('aria-pressed', String(mode !== POPUP_PIN_MODE_NONE));
  pinButton.title = title;
  pinButton.setAttribute('aria-label', title);
  });
}

function setPopupPinMode(element, mode) {
  if (!element) return;

  const currentMode = getPopupPinMode(element);
  if (currentMode === mode) {
    syncPinButton(element);
    return;
  }

  const rect = element.getBoundingClientRect();
  if (mode === POPUP_PIN_MODE_VIEWPORT) {
    element.style.position = 'fixed';
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
  } else {
    element.style.position = 'absolute';
    element.style.left = `${rect.left + window.scrollX}px`;
    element.style.top = `${rect.top + window.scrollY}px`;
  }

  element.dataset.pinMode = mode;
  element.classList.toggle('ai-translator-popup--pinned', mode !== POPUP_PIN_MODE_NONE);
  element.classList.toggle('ai-translator-popup--page-pinned', mode === POPUP_PIN_MODE_PAGE);
  syncPinButton(element);
}

function cyclePopupPinMode(element) {
  const currentMode = getPopupPinMode(element);
  const nextMode = {
    [POPUP_PIN_MODE_NONE]: POPUP_PIN_MODE_VIEWPORT,
    [POPUP_PIN_MODE_VIEWPORT]: POPUP_PIN_MODE_PAGE,
    [POPUP_PIN_MODE_PAGE]: POPUP_PIN_MODE_NONE,
  }[currentMode];
  setPopupPinMode(element, nextMode);
}

function clampPopupPosition(element, left, top, mode) {
  const margin = 8;
  const rect = element.getBoundingClientRect();
  const isViewportPosition = mode === POPUP_PIN_MODE_VIEWPORT || element.style.position === 'fixed';
  const originX = isViewportPosition ? 0 : window.scrollX;
  const originY = isViewportPosition ? 0 : window.scrollY;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const minLeft = originX + margin;
  const minTop = originY + margin;
  const maxLeft = Math.max(minLeft, originX + viewportWidth - rect.width - margin);
  const maxTop = Math.max(minTop, originY + viewportHeight - rect.height - margin);

  return {
    left: Math.min(Math.max(left, minLeft), maxLeft),
    top: Math.min(Math.max(top, minTop), maxTop),
  };
}

function stopPopupDrag(target = null) {
  if (!popupDragState || (target && popupDragState.element !== target)) return;

  const element = popupDragState.element;
  popupDragState = null;
  element?.classList.remove('ai-translator-popup--dragging');
  document.removeEventListener('mousemove', handlePopupDragMove);
  document.removeEventListener('mouseup', stopPopupDrag);
}

function handlePopupDragMove(event) {
  if (!popupDragState || !popupElements.has(popupDragState.element)) return;

  if (event.buttons === 0) {
    stopPopupDrag();
    return;
  }

  const { element, mode } = popupDragState;
  const isFixed = element.style.position === 'fixed';
  const pointerX = isFixed ? event.clientX : event.pageX;
  const pointerY = isFixed ? event.clientY : event.pageY;
  const nextPosition = clampPopupPosition(
    element,
    popupDragState.startLeft + pointerX - popupDragState.startX,
    popupDragState.startTop + pointerY - popupDragState.startY,
    mode,
  );
  element.style.left = `${nextPosition.left}px`;
  element.style.top = `${nextPosition.top}px`;
}

function startPopupDrag(event) {
  const element = event.currentTarget;
  if (!element || !popupElements.has(element) || event.button !== 0) return;

  if (event.target.closest?.('button, a, input, textarea, select')) return;

  const dragSurface = event.target.closest?.(
    '.ai-word-header, .ai-sentence-card, .ai-translator-loading, .ai-error',
  );
  if (event.target !== element && !dragSurface) return;

  const mode = getPopupPinMode(element);
  const rect = element.getBoundingClientRect();
  const isViewportPosition = mode === POPUP_PIN_MODE_VIEWPORT || element.style.position === 'fixed';
  popupDragState = {
    element,
    mode,
    startX: isViewportPosition ? event.clientX : event.pageX,
    startY: isViewportPosition ? event.clientY : event.pageY,
    startLeft: isViewportPosition ? rect.left : rect.left + window.scrollX,
    startTop: isViewportPosition ? rect.top : rect.top + window.scrollY,
  };

  element.classList.add('ai-translator-popup--dragging');
  event.preventDefault();
  document.addEventListener('mousemove', handlePopupDragMove);
  document.addEventListener('mouseup', stopPopupDrag);
}

function stopLoadingIndicator(owner) {
  owner?._stopThinkingOrb?.();
  if (owner) {
    owner._stopThinkingOrb = null;
    owner.classList.remove('ai-translator-popup--loading');
  }
}

function createLoadingIndicator(owner, label = 'Thinking…', size = 64) {
  stopLoadingIndicator(owner);
  owner.classList.add('ai-translator-popup--loading');
  const loading = document.createElement('div');
  loading.className = size === 20
    ? 'ai-translator-loading ai-translator-loading--compact'
    : 'ai-translator-loading';
  loading.setAttribute('role', 'status');
  loading.setAttribute('aria-live', 'polite');
  loading.setAttribute('aria-label', label);
  const canvas = document.createElement('canvas');
  canvas.className = 'ai-thinking-orb';
  canvas.setAttribute('aria-hidden', 'true');
  loading.appendChild(canvas);
  const text = document.createElement('span');
  text.className = 'ai-thinking-label';
  text.textContent = label;
  text.dataset.text = label;
  loading.appendChild(text);
  if (typeof AIThinkingOrb !== 'undefined') {
    owner._stopThinkingOrb = AIThinkingOrb.mount(canvas, {
      state: THINKING_ORB_STATE, size, displaySize: size === 64 ? 36 : size,
    });
  }
  return loading;
}

function showPopup(x, y, content, isLoading = false, isWord = false) {
  removeUnpinnedPopups();
  resetPopupView();
  popupElement = document.createElement('div');
  popupElement.className = 'ai-translator-popup';
  popupElement.dataset.pinMode = POPUP_PIN_MODE_NONE;
  popupElements.add(popupElement);
  if (isLoading) {
    popupElement.classList.add('ai-translator-popup--loading');
    popupElement.classList.toggle('ai-translator-popup--word', isWord);
  }
  popupElement.style.left = `${x}px`;
  popupElement.style.top = `${y + 15}px`;

  if (isLoading) {
    popupElement.appendChild(createLoadingIndicator(popupElement));
  } else {
    popupElement.innerHTML = content;
  }

  document.body.appendChild(popupElement);
  popupElement.addEventListener('mousedown', startPopupDrag);

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

  const occupied = [...popupElements].filter(p => p !== popupElement);
  if (occupied.some(p => overlapsPopup(popupElement.getBoundingClientRect(), p.getBoundingClientRect()))) {
    positionRelatedPopup(popupElement, null, occupied);
  }
  watchPopupSize(popupElement);
  return popupElement;
}

function updatePopup(content) {
  if (popupElement) {
    stopLoadingIndicator(popupElement);
    popupElement.classList.remove('ai-translator-popup--loading');
    popupElement.innerHTML = '';
    popupElement.appendChild(content);
  }
}

function updatePopupError(message) {
  if (popupElement) {
    stopLoadingIndicator(popupElement);
    resetPopupView();
    popupElement.classList.remove('ai-translator-popup--loading');
    popupElement.innerHTML = '';
    const div = document.createElement('div');
    div.className = 'ai-error';
    div.textContent = message;
    popupElement.appendChild(div);
  }
}

function resetPopupView() {
  popupView = null;
  typewriterQueue = Promise.resolve();
}

function queueTypewriter(element, value, speed = 18) {
  const text = value || '';
  typewriterQueue = typewriterQueue.then(() => new Promise((resolve) => {
    if (!element || !element.isConnected) {
      resolve();
      return;
    }

    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      element.textContent = text;
      resolve();
      return;
    }

    const characters = Array.from(text);
    let index = 0;
    element.textContent = '';
    element.classList.add('ai-typewriter-active');

    function typeNext() {
      if (!element.isConnected) {
        resolve();
        return;
      }

      element.textContent += characters[index] || '';
      index += 1;
      if (index < characters.length) {
        setTimeout(typeNext, speed);
      } else {
        element.classList.remove('ai-typewriter-active');
        resolve();
      }
    }

    if (characters.length > 0) typeNext();
    else resolve();
  }));
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

function createPinButton(owner = popupElement) {
  const btn = document.createElement('button');
  btn.className = 'ai-pin-btn';
  btn.type = 'button';
  btn.dataset.pinMode = getPopupPinMode(owner);
  btn.setAttribute('aria-pressed', String(isPopupPinned(owner)));
  btn.title = getPinButtonTitle(getPopupPinMode(owner));
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 17v5"/>
      <path d="M5 17h14"/>
      <path d="M7 17V9L5 7h14l-2 2v8"/>
      <path d="M9 3h6"/>
      <path d="M9 3v4"/>
      <path d="M15 3v4"/>
    </svg>
  `;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    cyclePopupPinMode(owner);
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
  if (!popupView || popupView.type !== 'word' || popupView.word !== word) {
    popupView = createWordPopupView(word);
    updatePopup(popupView.card);
  }

  updateWordPopupView(data, word, popupView);
}

function updateWordPopupView(data, word, popupView) {
  if (data.meaning && data.meaning !== popupView.meaning) {
    popupView.meaning = data.meaning;
    popupView.meaningElement.classList.remove('ai-stream-pending');
    queueTypewriter(popupView.meaningElement, data.meaning, 22);
  }

  if (data.pos && data.pos !== popupView.pos) {
    popupView.pos = data.pos;
    popupView.metaElement.classList.remove('ai-stream-pending');
    queueTypewriter(popupView.posElement, data.pos, 28);
  }

  const components = Array.isArray(data.components) && data.components.length > 0
    ? data.components.filter(component => component && component.text)
    : (data.root ? [{ text: data.root, type: '词根', meaning: '' }] : []);
  const componentsKey = JSON.stringify(components);
  if (components.length > 0 && componentsKey !== popupView.componentsKey) {
    popupView.componentsKey = componentsKey;
    popupView.componentBlock.classList.remove('ai-stream-pending');
    popupView.componentList.replaceChildren();

    components.forEach((component) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ai-component-chip';
      chip.setAttribute('aria-label', `查看 ${component.text} 的同根词`);
      chip.addEventListener('click', (event) => {
        event.stopPropagation();
        appendRelatedWords(popupView.card, word, component);
      });
      const details = [component.type, component.meaning].filter(Boolean).join('：');
      if (details) chip.title = details;
      popupView.componentList.appendChild(chip);
      chip.textContent = component.text;
      chip.style.width = `${Math.ceil(chip.getBoundingClientRect().width)}px`;
      chip.textContent = '';
      queueTypewriter(chip, component.text, 24);
    });
  }

  const composition = data.composition || data.origin || '';
  if (composition && composition !== popupView.composition) {
    popupView.composition = composition;
    queueTypewriter(popupView.compositionElement, composition, 14);
  }
}

function renderSentencePopup(data) {
  if (!popupView || popupView.type !== 'sentence') {
    const card = document.createElement('div');
    card.className = 'ai-sentence-card';
    const item = createItem('翻译：', '');
    card.appendChild(item);
    popupView = {
      type: 'sentence',
      card,
      translation: '',
      valueElement: item.querySelector('.ai-val'),
    };
    updatePopup(card);
  }

  if (data.translation && data.translation !== popupView.translation) {
    popupView.translation = data.translation;
    queueTypewriter(popupView.valueElement, data.translation, 18);
  }
}

function createWordPopupView(word, owner = popupElement) {
  const card = document.createElement('div');
  card.className = 'ai-word-card';

  const wordHeader = document.createElement('div');
  wordHeader.className = 'ai-word-header';
  const wordIdentity = document.createElement('div');
  wordIdentity.className = 'ai-word-identity';
  const wordSpan = document.createElement('span');
  wordSpan.className = 'ai-word-text';
  wordSpan.textContent = word;
  wordIdentity.appendChild(wordSpan);
  wordIdentity.appendChild(createSpeakerButton(word));
  wordHeader.appendChild(wordIdentity);
  wordHeader.appendChild(createPinButton(owner));
  card.appendChild(wordHeader);

  const meaningElement = document.createElement('div');
  meaningElement.className = 'ai-word-meaning ai-stream-pending';
  card.appendChild(meaningElement);

  const metaElement = document.createElement('div');
  metaElement.className = 'ai-word-meta ai-stream-pending';
  const posElement = document.createElement('span');
  posElement.className = 'ai-pos-tag';
  metaElement.appendChild(posElement);
  card.appendChild(metaElement);

  const componentBlock = document.createElement('div');
  componentBlock.className = 'ai-component-block ai-stream-pending';
  const componentHeading = document.createElement('div');
  componentHeading.className = 'ai-component-heading';
  const rootLabel = document.createElement('span');
  rootLabel.className = 'ai-component-label';
  rootLabel.textContent = '构词';
  const componentList = document.createElement('div');
  componentList.className = 'ai-component-list';
  componentHeading.appendChild(rootLabel);
  componentHeading.appendChild(componentList);
  componentBlock.appendChild(componentHeading);

  const compositionElement = document.createElement('div');
  compositionElement.className = 'ai-component-explanation';
  componentBlock.appendChild(compositionElement);
  card.appendChild(componentBlock);

  return {
    type: 'word',
    word,
    card,
    meaning: '',
    pos: '',
    componentsKey: '',
    composition: '',
    meaningElement,
    metaElement,
    posElement,
    componentBlock,
    componentList,
    compositionElement,
  };
}

// Exploration windows have independent lifetimes, positions and pin buttons.
function overlapsPopup(a, b, gap = 12) {
  return a.left < b.right + gap && a.right + gap > b.left &&
    a.top < b.bottom + gap && a.bottom + gap > b.top;
}

function findPopupSpace(size, anchor, occupied, viewport) {
  const gap = 12;
  const maxLeft = Math.max(gap, viewport.width - size.width - gap);
  const rectAt = (left, top) => ({ left, top, right: left + size.width, bottom: top + size.height });
  const candidates = [
    { left: anchor.right + gap, top: Math.max(gap, anchor.top), placement: 'right' },
    { left: Math.max(gap, Math.min(anchor.left, maxLeft)), top: Math.max(gap, anchor.bottom + gap), placement: 'below' },
  ];
  const xs = [...new Set([gap, ...occupied.map(r => r.right + gap)])].sort((a, b) => a - b);
  const ys = [...new Set([gap, ...occupied.map(r => r.bottom + gap)])].sort((a, b) => a - b);
  for (const top of ys) for (const left of xs) candidates.push({left, top, placement: 'free'});
  const available = candidate => candidate.left >= gap && candidate.left <= maxLeft &&
    !occupied.some(r => overlapsPopup(rectAt(candidate.left, candidate.top), r));
  // Keep new windows on screen when possible; otherwise extend downward on the page.
  const visible = candidates.find(c => c.top + size.height <= viewport.height - gap && available(c));
  if (visible) return visible;
  const below = candidates[1];
  if (available(below)) return below;
  return { left: Math.max(gap, Math.min(anchor.left, maxLeft)),
    top: Math.max(gap, ...occupied.map(r => r.bottom + gap)), placement: 'below' };
}

function positionRelatedPopup(owner, anchor, obstacles = [...popupElements].filter(p => p !== owner)) {
  const rect = anchor?.getBoundingClientRect() || owner.getBoundingClientRect();
  const size = owner.getBoundingClientRect();
  const next = findPopupSpace(size, rect, obstacles.map(p => p.getBoundingClientRect()),
    { width: window.innerWidth, height: window.innerHeight });
  const fixed = owner.style.position === 'fixed';
  owner.style.left = `${next.left + (fixed ? 0 : window.scrollX)}px`;
  owner.style.top = `${next.top + (fixed ? 0 : window.scrollY)}px`;
  owner.dataset.placement = next.placement;
}

function watchPopupSize(owner) {
  if (typeof ResizeObserver === 'undefined') return;
  const observer = new ResizeObserver(() => {
    const earlier = [];
    // Keep earlier cards in place, move only later cards that now collide.
    for (const popup of popupElements) {
      if (earlier.some(p => overlapsPopup(popup.getBoundingClientRect(), p.getBoundingClientRect()))) {
        positionRelatedPopup(popup, popup._placementAnchor, earlier);
      }
      earlier.push(popup);
    }
  });
  observer.observe(owner);
  owner._sizeObserver = observer;
}

function createExplorationPopup(card, title, isWord = false) {
  const anchor = card.closest('.ai-translator-popup');
  if (!anchor || !popupElements.has(anchor)) return null;
  const owner = document.createElement('div');
  owner.className = 'ai-translator-popup ai-exploration-popup';
  owner.dataset.pinMode = POPUP_PIN_MODE_NONE;
  const header = document.createElement('div');
  header.className = 'ai-word-header';
  const heading = document.createElement('div');
  heading.className = 'ai-trail-heading';
  heading.textContent = title;
  const controls = document.createElement('div');
  controls.className = 'ai-popup-controls';
  controls.appendChild(createPinButton(owner));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ai-close-btn';
  close.textContent = '×';
  close.title = '关闭此窗口';
  close.setAttribute('aria-label', '关闭此窗口');
  close.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    removePopup(owner, true);
  });
  controls.appendChild(close);
  header.append(heading, controls);
  const body = document.createElement('div');
  body.className = 'ai-exploration-body';
  owner.append(header, body);
  popupElements.add(owner);
  document.body.appendChild(owner);
  owner.addEventListener('mousedown', startPopupDrag);
  owner._placementAnchor = anchor;
  positionRelatedPopup(owner, anchor);
  watchPopupSize(owner);
  return { owner, section: owner, body };
}

function requestTrailData(trail, request, onData) {
  const { owner, body } = trail;
  const run = () => {
    body.replaceChildren();
    body.appendChild(createLoadingIndicator(owner, 'Thinking…', 20));
    let port;
    let finished = false;
    const finish = () => {
      finished = true;
      stopLoadingIndicator(owner);
      owner._relatedPorts?.delete(port);
      disconnectTranslationPort(port);
    };
    const fail = (message) => {
      if (!body.isConnected) { finish(); return; }
      body.replaceChildren();
      const error = document.createElement('div');
      error.className = 'ai-error';
      error.textContent = message;
      const retry = document.createElement('button');
      retry.className = 'ai-related-word';
      retry.type = 'button';
      retry.textContent = '重试';
      retry.addEventListener('click', run);
      body.append(error, retry);
      finish();
    };
    try {
      port = chrome.runtime.connect({ name: 'translation-stream' });
      owner._relatedPorts ||= new Set();
      owner._relatedPorts.add(port);
      port.onMessage.addListener((message) => {
        if (finished || !body.isConnected) return;
        if (message.type === 'error') { fail(message.error || '查询失败，请重试。'); return; }
        if (message.type !== 'result') return;
        try {
          body.replaceChildren();
          onData(message.data, body, owner);
          finish();
        } catch (error) { fail(error.message || '返回格式异常，请重试。'); }
      });
      port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (!finished) fail(error?.message || '连接已中断，请重试。');
      });
      port.postMessage(request);
    } catch (error) { fail('扩展连接已失效，请刷新页面后重试。'); }
  };
  run();
}

function appendRelatedWords(card, word, component) {
  const trail = createExplorationPopup(card, `${word} › ${component.text} · 同根词`);
  if (!trail) return;
  requestTrailData(trail, { action: 'relatedWords', word, component }, (data, body) => {
    if (!Array.isArray(data?.words) || !data.words.length) throw new Error('未找到可靠的同根词。');
    const list = document.createElement('div');
    list.className = 'ai-related-list';
    data.words.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ai-related-word';
      const name = document.createElement('strong');
      name.textContent = item.word;
      const meaning = document.createElement('span');
      meaning.textContent = item.meaning;
      button.append(name, meaning);
      button.title = item.relation;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        appendTrailWord(trail.section, item.word);
      });
      list.appendChild(button);
    });
    body.appendChild(list);
    if (data.words.length < 5) {
      const note = document.createElement('div');
      note.className = 'ai-trail-heading';
      note.textContent = `仅找到 ${data.words.length} 个可靠的同根词。`;
      body.appendChild(note);
    }
  });
}

function appendTrailWord(card, word) {
  const trail = createExplorationPopup(card, `单词详解 · ${word}`, true);
  if (!trail) return;
  requestTrailData(trail, { action: 'translate', text: word, isWord: true }, (data, body, owner) => {
    if (data?.type !== 'word') throw new Error('单词讲解格式异常，请重试。');
    const view = createWordPopupView(word, owner);
    view.card.querySelector('.ai-pin-btn')?.remove();
    body.appendChild(view.card);
    updateWordPopupView(data, word, view);
  });
}
