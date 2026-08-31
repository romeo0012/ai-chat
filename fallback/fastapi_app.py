import os
import json
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent.parent / '.env')

app = FastAPI(title="AI Chat Fallback")

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4o')
OPENAI_BASE_URL = os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1')

client = None
if OPENAI_API_KEY:
    client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

SYSTEM_PROMPT = (
    "Jsi asistent pro platformu Virtuozzo Application Platform (dříve Jelastic).\n\n"
    "PRAVIDLA:\n"
    "1. ODPOVÍDEJ VŽDY V UŽIVATELOVĚ ZVOLENÉM JAZYCE (language parametr).\n"
    "2. Odpovídej z vlastních znalostí o platformě. Pokud něco nevíš, přiznej to.\n"
    "3. KDYŽ SE UŽIVATEL PTÁ NA POSTUP (jak něco udělat, zprovoznit, nainstalovat, nastavit), "
    "DEJ MU KONKRÉTNÍ KROK ZA KROKEM – číslovaný seznam kroků.\n"
    "4. Neodkazuj na konkrétní URL adresy dokumentace, protože je nemáš k dispozici."
)

LANG_INSTRUCTION = {
    'cz': 'ODPOVÍDEJ VŽDY ČESKY. Používej české výrazy. Odpovídej česky na jakýkoliv dotaz bez ohledu na jazyk otázky.',
    'en': 'ALWAYS ANSWER IN ENGLISH. Use English terms. Respond in English to any question regardless of the question language.',
    'de': 'ANTWORTE IMMER AUF DEUTSCH. Verwende deutsche Begriffe. Antworte auf Deutsch auf jede Frage unabhängig von der Fragesprache.',
}


class Message(BaseModel):
    role: str
    content: str


class FallbackRequest(BaseModel):
    query: str
    history: list[Message] = []
    language: str = 'cz'


@app.post("/fallback")
async def fallback(request: FallbackRequest):
    if not client:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")

    lang = request.language if request.language in LANG_INSTRUCTION else 'cz'
    lang_instruction = LANG_INSTRUCTION[lang]
    system_content = lang_instruction + '\n\n' + SYSTEM_PROMPT

    messages = [{"role": "system", "content": system_content}]
    for msg in request.history:
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": request.query})

    try:
        stream = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=messages,
            temperature=0.3,
            max_tokens=2048,
            stream=True,
        )

        def generate():
            for chunk in stream:
                delta = chunk.choices[0].delta if chunk.choices else None
                if delta and delta.content:
                    yield delta.content

        return StreamingResponse(generate(), media_type="text/plain")

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    return {"status": "ok", "model": OPENAI_MODEL}
