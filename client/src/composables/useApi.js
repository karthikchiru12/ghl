import { ref } from 'vue';

// Module-level state — shared across all consumers
const toast = ref(null);
const contextToken = ref('');

export function useApi() {
  const setContextToken = (value) => {
    contextToken.value = value || '';
  };

  const showError = (msg) => {
    toast.value = { message: msg, type: 'error' };
    setTimeout(() => { toast.value = null; }, 5000);
  };

  const showSuccess = (msg) => {
    toast.value = { message: msg, type: 'success' };
    setTimeout(() => { toast.value = null; }, 3000);
  };

  const apiFetch = async (url, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (contextToken.value) {
      headers.set('x-ghl-context', contextToken.value);
    }

    const res = await fetch(url, { ...options, headers });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  };

  return { toast, showError, showSuccess, apiFetch, setContextToken };
}
