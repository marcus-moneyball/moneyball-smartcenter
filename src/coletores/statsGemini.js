'use strict';

const { GoogleGenAI } = require('@google/genai');

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
  futebol: 'site:fotmob.com OR site:sofascore.com OR site:understat.com',
  basquete: 'site:basketball-reference.com OR site:nba.com OR site:espn.com',
  beisebol: 'site:baseballsavant.com OR site:baseball-reference.com OR site:fangraphs.com',
};

// Mapeia os campos que filtroQualidade.js exige (REQUISITOS_POR_ESPORTE) para
// o que pedimos ao Gemini. Mudou o filtro, muda aqui também.
const CAMPOS_POR_ESPORTE = {
  futebol: ['home_xg_ataque', 'home_xga_defesa', 'away_xg_ataque', 'away_xga_defesa'],
  // Mesmos nomes de campo reaproveitados nos três esportes por compatibilidade
  // de código -- representam a média marcada/sofrida por jogo na unidade de
  // cada esporte (gols, pontos, corridas), não xG de verdade. É a mesma
  // métrica que os providers de API real usam (statsFootballData.js,
  // statsBallDontLie.js, statsMlbApi.js) -- Gemini é só o fallback quando
  // essas APIs não cobrem o time/liga.
  basquete: ['home_xg_ataque', 'home_xga_defesa', 'away_xg_ataque', 'away_xga_defesa'],
  beisebol: ['home_xg_ataque', 'home_xga_defesa', 'away_xg_ataque', 'away_xga_defesa'],
};

let clienteGemini = null;
function getClienteGemini() {
  if (clienteGemini) return clienteGemini;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  clienteGemini = new GoogleGenAI({ apiKey });
  return clienteGemini;
}

/**
 * @param {string} esporte - 'futebol' | 'basquete' | 'beisebol'
 * @param {string} timeA
 * @param {string} timeB
 * @returns {Promise<Object|null>} objeto no formato { [esporte]: { ...campos... } } ou null
 */
async function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extrai o retryDelay sugerido pela própria API do Gemini no corpo do erro
 * 429 (quando presente), ou usa um backoff padrão crescente.
 */
function calcularEsperaRetry(erro, tentativa) {
  const match = String(erro?.message || '').match(/"retryDelay":"(\d+)s"/);
  if (match) return Number(match[1]) * 1000 + 500; // +500ms de folga
  return tentativa * 5000; // backoff simples: 5s, 10s, 15s...
}

const DESCRICAO_CAMPOS_POR_ESPORTE = {
  futebol: 'xG (gols esperados) a favor e contra, por jogo, na temporada atual',
  // Nomes de campo reaproveitados do futebol por compatibilidade de código,
  // mas aqui representam PONTOS marcados/sofridos por jogo -- não xG.
  basquete: 'pontos marcados e sofridos por jogo (média da temporada atual) -- NÃO é xG, isso é terminologia de futebol',
  beisebol: 'corridas marcadas e sofridas por jogo (média da temporada atual) -- NÃO é ERA nem K/9, é corridas de fato',
};

async function investigarStats(esporte, timeA, timeB, tentativa = 1) {
  const genAI = getClienteGemini();
  const fontes = FONTES_AUTORIZADAS_POR_ESPORTE[esporte];
  const campos = CAMPOS_POR_ESPORTE[esporte];
  const descricaoCampos = DESCRICAO_CAMPOS_POR_ESPORTE[esporte];

  if (!genAI || !fontes || !campos) return null;

  const exemploJson = Object.fromEntries(campos.map((c) => [c, null]));

  const prompt = `Você é um investigador quantitativo esportivo. Busque na internet, OBRIGATORIAMENTE
usando o operador de busca ${fontes}, as estatísticas mais recentes e confiáveis dos
times "${timeA}" e "${timeB}" para ${esporte.toUpperCase()}.

Os campos abaixo representam: ${descricaoCampos}.

Retorne ESTRITAMENTE este JSON, sem markdown, sem texto fora do JSON:
${JSON.stringify(exemploJson)}

Regras:
- Preencha CADA campo individualmente com o valor real encontrado na fonte autorizada.
- Se não encontrar dado confiável para um campo específico, retorne null NESSE campo --
  NÃO invente número, e não deixe de retornar os demais campos por causa de um só faltando.
- Se não encontrar dado confiável para NENHUM dos campos, retorne null no lugar do JSON inteiro.`;

  const MAX_TENTATIVAS = 3;
  let textoBrutoParaDebug = '(sem resposta)';

  try {
    const resultado = await genAI.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      config: {
        temperature: 0,
        tools: [{ googleSearch: {} }],
      },
    });

    const texto = resultado.text.trim().replace(/^```json\s*|\s*```$/g, '');
    textoBrutoParaDebug = texto;
    const json = JSON.parse(texto);

    if (!json || campos.every((c) => json[c] == null)) {
      console.log(`[STATS GEMINI] ${timeA} x ${timeB} (${esporte}): sem dado confiável em nenhum campo. Resposta bruta: ${texto.slice(0, 300)}`);
      return null;
    }

    const camposComDado = campos.filter((c) => json[c] != null);
    console.log(`[STATS GEMINI] ${timeA} x ${timeB} (${esporte}): ${camposComDado.length}/${campos.length} campos preenchidos (${camposComDado.join(', ')}).`);

    return { [esporte]: json };
  } catch (erro) {
    const eRateLimit = String(erro?.message || '').includes('RESOURCE_EXHAUSTED') || erro?.status === 429;

    if (eRateLimit && tentativa < MAX_TENTATIVAS) {
      const espera = calcularEsperaRetry(erro, tentativa);
      console.warn(`[STATS GEMINI] Rate limit (tentativa ${tentativa}/${MAX_TENTATIVAS}) -- aguardando ${espera}ms antes de tentar de novo.`);
      await esperar(espera);
      return investigarStats(esporte, timeA, timeB, tentativa + 1);
    }

    console.warn(`[STATS GEMINI] Falha ao investigar stats de ${timeA} x ${timeB} (fail-open): ${erro.message} | resposta bruta: ${textoBrutoParaDebug.slice(0, 300)}`);
    return null;
  }
}

module.exports = { investigarStats, FONTES_AUTORIZADAS_POR_ESPORTE };
