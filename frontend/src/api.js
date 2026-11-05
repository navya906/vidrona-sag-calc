async function request(path, init) {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = Array.isArray(body.detail) ? body.detail.map((d) => `${d.loc.at(-1)}: ${d.msg}`).join('; ') : body.detail
    throw new Error(detail || `Request failed (${res.status})`)
  }
  return res.json()
}

export const getMeta = (signal) => request('/meta', { signal })

export const calculate = (payload, signal) =>
  request('/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal })

export const vectorize = (file, signal) => {
  const body = new FormData()
  body.append('file', file)
  return request('/vectorize', { method: 'POST', body, signal })
}

export const analyzePhoto = (file, signal) => {
  const body = new FormData()
  body.append('file', file)
  return request('/analyze-photo', { method: 'POST', body, signal })
}
