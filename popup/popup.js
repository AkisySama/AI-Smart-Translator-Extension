const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

const DEFAULT_MODELS = {
  openai: "gpt-5.4-mini",
  deepseek: "deepseek-v4-flash",
};

function modelsEndpoint(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("请填写有效的 HTTP 或 HTTPS API 地址。");
  }
  let pathname = url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  if (!pathname.endsWith("/models")) pathname += "/models";
  url.pathname = pathname;
  url.hash = "";
  return url.href;
}

document.addEventListener("DOMContentLoaded", () => {
  const providerBtns = document.getElementById("providerBtns");
  const apiUrlInput = document.getElementById("apiUrl");
  const apiKeyInput = document.getElementById("apiKey");
  const modelNameInput = document.getElementById("modelName");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");

  const modelSelect = document.getElementById("modelSelect");
  const modelStatus = document.getElementById("modelStatus");
  const refreshModels = document.getElementById("refreshModels");
  let requestVersion = 0;
  let requestController;
  let debounceTimer;
  let currentProvider = null;

  function resetModels(message) {
    modelSelect.replaceChildren(new Option(message, ""));
    modelSelect.disabled = true;
  }

  function scheduleModels(delay = 500) {
    clearTimeout(debounceTimer);
    requestController?.abort();
    requestVersion++;
    resetModels("等待获取模型");
    modelStatus.textContent = "";
    refreshModels.disabled = false;
    if (!apiUrlInput.value.trim() || !apiKeyInput.value.trim()) {
      resetModels("请先填写 API 信息");
      modelStatus.textContent = "填写 API URL 和 Key 后自动获取，也可手动输入模型。";
      return;
    }
    debounceTimer = setTimeout(fetchModels, delay);
  }

  async function fetchModels() {
    const version = ++requestVersion;
    const controller = new AbortController();
    requestController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    refreshModels.disabled = true;
    resetModels("正在获取模型…");
    modelStatus.textContent = "正在获取模型…";
    try {
      const endpoint = modelsEndpoint(apiUrlInput.value.trim());
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKeyInput.value.trim()}` },
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) throw new Error("鉴权失败，请检查 API Key 和模型访问权限。");
        if (response.status === 404 || response.status === 405) throw new Error("此接口不支持获取模型列表，请手动输入。");
        if (response.status === 429) throw new Error("请求过于频繁，请稍后刷新。");
        throw new Error(`获取失败（HTTP ${response.status}），请稍后刷新。`);
      }
      const data = await response.json();
      if (!Array.isArray(data.data)) throw new Error("模型列表格式不兼容，请手动输入。");
      const ids = [...new Set(data.data.map(item => item?.id).filter(id => typeof id === "string" && id.trim()))].sort();
      if (version !== requestVersion) return;
      if (!ids.length) throw new Error("接口未返回可用模型，请手动输入。");
      modelSelect.replaceChildren(new Option("选择模型（或在下方手动输入）", ""));
      ids.forEach(id => modelSelect.add(new Option(id, id)));
      modelSelect.disabled = false;
      modelSelect.value = ids.includes(modelNameInput.value.trim()) ? modelNameInput.value.trim() : "";
      modelStatus.textContent = `已获取 ${ids.length} 个模型，请选择支持文本对话的模型。`;
    } catch (error) {
      if (version !== requestVersion) return;
      resetModels("获取失败，可手动输入");
      modelStatus.textContent = error.name === "AbortError" ? "请求超时，请刷新重试或手动输入。" : error instanceof TypeError ? "请检查 API 地址和网络，或手动输入模型。" : error.message;
    } finally {
      clearTimeout(timeout);
      if (version === requestVersion) refreshModels.disabled = false;
    }
  }

  modelSelect.addEventListener("change", () => {
    if (modelSelect.value) modelNameInput.value = modelSelect.value;
  });
  modelNameInput.addEventListener("input", () => {
    modelSelect.value = modelNameInput.value.trim();
  });
  refreshModels.addEventListener("click", () => scheduleModels(0));
  apiKeyInput.addEventListener("input", () => scheduleModels());
  let allSettings = {}; // providerSettings from storage

  // Reflect current provider's saved values into the form fields
  function loadProviderFields(provider) {
    const saved = (allSettings[provider] || {});
    apiUrlInput.value = saved.apiUrl || PROVIDER_URLS[provider] || "";
    apiKeyInput.value = saved.apiKey || "";
    modelNameInput.value = saved.modelName || DEFAULT_MODELS[provider] || "";
  }

  // Save current form values back into allSettings for the given provider
  function saveProviderFields(provider) {
    allSettings[provider] = {
      apiUrl: apiUrlInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      modelName: modelNameInput.value.trim(),
    };
  }

  function setActiveProvider(provider) {
    // Save fields for the provider we're leaving
    if (currentProvider) saveProviderFields(currentProvider);

    currentProvider = provider;

    // Update button active states
    providerBtns.querySelectorAll(".provider-btn").forEach((btn) => {
      if (btn.dataset.provider === provider) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // Load fields for the new provider
    loadProviderFields(provider);
    scheduleModels(0);

    // Focus the key field if it's empty and URL is pre-filled
    if (!apiKeyInput.value && apiUrlInput.value) {
      apiKeyInput.focus();
    } else if (!apiUrlInput.value) {
      apiUrlInput.focus();
    }
  }

  // Provider button clicks
  providerBtns.addEventListener("click", (e) => {
    const btn = e.target.closest(".provider-btn");
    if (!btn) return;
    const provider = btn.dataset.provider;
    if (provider !== currentProvider) {
      setActiveProvider(provider);
    }
  });

  // Keep the edited URL and key together, including custom compatible endpoints.
  apiUrlInput.addEventListener("input", () => scheduleModels());

  // --- Init: load from storage ---
  chrome.storage.local.get(
    ["providerSettings", "apiUrl", "apiKey", "modelName", "provider"],
    (result) => {
      // Migrate old flat format to per-provider if needed
      if (result.providerSettings) {
        allSettings = result.providerSettings;
      } else {
        // First-time migration: save existing flat values under their provider
        const oldProvider = result.provider || "custom";
        allSettings = {};
        allSettings[oldProvider] = {
          apiUrl: result.apiUrl || "",
          apiKey: result.apiKey || "",
          modelName: result.modelName || "",
        };
      }

      const savedProvider = result.provider || "custom";
      setActiveProvider(savedProvider);
    },
  );

  // Save settings
  saveBtn.addEventListener("click", () => {
    // Save current form state into allSettings
    saveProviderFields(currentProvider);

    const active = allSettings[currentProvider] || {};
    chrome.storage.local.set(
      {
        providerSettings: allSettings,
        apiUrl: active.apiUrl,
        apiKey: active.apiKey,
        modelName: active.modelName,
        provider: currentProvider,
      },
      () => {
        statusDiv.textContent = "设置已保存";
        statusDiv.classList.add("visible");
        setTimeout(() => {
          statusDiv.textContent = "";
          statusDiv.classList.remove("visible");
        }, 2000);
      },
    );
  });
});
