'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Réplica, no SmartCenter, da técnica MIE1 do Pro (ver mie1_gemini.py):
 * Gemini com Google Search Grounding, forçado a buscar SOMENTE nas fontes
 * autorizadas por esporte (mesma lista que você usa no Pro). Isso substitui
 * a tentativa anterior de calcular proxies a partir de football-data.org/
 * balldontlie.io -- em vez de aproximar xG/net-rating/pace com dados que
 * essas APIs não têm, o Gemini busca o número real publicado nessas fontes.
 *
 * Mesma regra do Pro: se não achar dado confiável, devolve null no campo
 * (nunca inventa número). Fail-open: erro de rede/parse também vira null,
 * sem derrubar a rodada.
 */

const FONTES_AUTORIZADAS_POR_ESPORTE = {
  futebol: 'site:fbref.com OR site:sofascore.com',
  basquete: 'site:basketball-reference.com OR site:nba.com',
  beisebol: 'site:baseballsavant.com OR site:baseball-reference.com',
};

// Mapeia os campos que filtroQualidade.js exige (REQUISITOS_POR_ESPORTE) para
// o que pedimos ao Gemini. Mudou o filtro, muda aqui também.
const CAMPOS_POR_ESPORTE = {
  futebol: ['home_xg_ataque', 'home_xga_defesa', 'away_xg_ataque', 'away_xga_defesa'],
  basquete: ['net_rating_casa', 'net_rating_visitante', 'pace_casa'],
  beisebol: ['era_titular_casa', 'era_titular_visitante', 'k9_titular_casa'],
};

let clienteGemini = null;
function getClienteGemini() {
  if (clienteGemini) return clienteGemini;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  clienteGemini = new GoogleGenerativeAI(apiKey);
  return clienteGemini;
}

/**
 * @param {string} esporte - 'futebol' | 'basquete' | 'beisebol'
 * @param {string} timeA
 * @param {string} timeB
 * @returns {Promise<Object|null>} objeto no formato { [esporte]: { ...campos... } } ou null
 */
async function investigarStats(esporte, timeA, timeB) {
  const genAI = getClienteGemini();
  const fontes = FONTES_AUTORIZADAS_POR_ESPORTE[esporte];
  const campos = CAMPOS_POR_ESPORTE[esporte];

  if (!genAI || !fontes || !campos) return null;

  const exemploJson = Object.fromEntries(campos.map((c) => [c, null]));

  const prompt = `Você é um investigador quantitativo esportivo. Busque na internet, OBRIGATORIAMENTE
usando o operador de busca ${fontes}, as estatísticas mais recentes e confiáveis dos
times "${timeA}" e "${timeB}" para ${esporte.toUpperCase()}.

Retorne ESTRITAMENTE este JSON, sem markdown, sem texto fora do JSON:
${JSON.stringify(exemploJson)}

Regras:
- Preencha CADA campo individualmente com o valor real encontrado na fonte autorizada.
- Se não encontrar dado confiável para um campo específico, retorne null NESSE campo --
  NÃO invente número, e não deixe de retornar os demais campos por causa de um só faltando.
- Se não encontrar dado confiável para NENHUM dos campos, retorne null no lugar do JSON inteiro.`;

  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      tools: [{ googleSearch: {} }],
    });

    const resultado = await model.generateContent(prompt);
    const texto = resultado.response.text().trim().replace(/^```json\s*|\s*```$/g, '');
    const json = JSON.parse(texto);

    if (!json || campos.every((c) => json[c] == null)) return null;

    return { [esporte]: json };
  } catch (erro) {
    console.warn(`[STATS GEMINI] Falha ao investigar stats de ${timeA} x ${timeB} (fail-open): ${erro.message}`);
    return null;
  }
}

module.exports = { investigarStats, FONTES_AUTORIZADAS_POR_ESPORTE };
