export async function requisitarOllamaApi(messages) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: OLLAMA_MODEL,
                messages,
                stream: false,
                keep_alive: '30m',
                options: { 
                    num_ctx: 512, 
                    num_predict: 120, 
                    temperature: 0.4 
                }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) return null;

        const data = await response.json();
        return data.message?.content?.trim() || null;
    } catch (error) {
        console.error('[ia] Erro de comunicação com o Ollama:', error.message);
        return null;
    }
}