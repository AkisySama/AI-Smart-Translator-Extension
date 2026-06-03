const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

const DEFAULT_MODELS = {
  openai: "gpt-5.4-mini",
  deepseek: "deepseek-v4-flash",
};

document.addEventListener("DOMContentLoaded", () => {
  const providerBtns = document.getElementById("providerBtns");
  const apiUrlInput = document.getElementById("apiUrl");
  const apiKeyInput = document.getElementById("apiKey");
  const modelNameInput = document.getElementById("modelName");
  const saveBtn = document.getElementById("saveBtn");
  const statusDiv = document.getElementById("status");

  let currentProvider = "custom";
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
    saveProviderFields(currentProvider);

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

  // If user manually edits the URL, switch to custom if URL no longer matches preset
  apiUrlInput.addEventListener("input", () => {
    const val = apiUrlInput.value.trim();
    const matchedProvider = Object.entries(PROVIDER_URLS).find(
      ([, url]) => url === val,
    );
    if (matchedProvider && matchedProvider[0] !== currentProvider) {
      setActiveProvider(matchedProvider[0]);
    } else if (!matchedProvider && currentProvider !== "custom") {
      setActiveProvider("custom");
    }
  });

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
        statusDiv.textContent = "保存成功!";
        setTimeout(() => {
          statusDiv.textContent = "";
        }, 2000);
      },
    );
  });
});
