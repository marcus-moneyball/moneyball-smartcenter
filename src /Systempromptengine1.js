'use strict';

/**
 * montarSystemPromptEngine1(esporte)
 *
 * Gera o System Prompt do "Engine 1" (Gemini, com Google Search grounding).
 * Responsabilidade do Engine 1: pesquisar, coletar e estruturar — NUNCA
 * calcular EV, probabilidade final, robustez ou classificação de valor.
 * Isso é trabalho exclusivo do Engine 2 (Groq, ver groqService.js).
 *
 * A saída daqui precisa bater com o formato que o system prompt do Groq já
 * sabe interpretar (o mesmo JSON que antes era colado manualmente no app
 * antigo — "Moneyball Engine JSON"). Isso é o contrato Engine 1 → Engine 2.
 *
 * Substitui o antigo systemPrompt.js (baseado em Pódio Ouro/Prata/Bronze) —
 * aquele contrato foi superado por essa arquitetura de 2 engines.
 */

const LEIS_GERAIS = `
### LEIS GERAIS DO ENGINE 1 (VALEM PARA QUALQUER ESPORTE)

1. Sua função é EXCLUSIVAMENTE pesquisa e estruturação. Você NUNCA calcula probabilidade estimada, Expected Value, robustez ou classificação de valor — isso é proibido aqui, é trabalho do Engine 2.
2. Use SEMPRE a busca do Google (grounding) para confirmar odds, estatísticas e contexto atuais — nunca responda com dado da sua memória interna sem confirmar, especialmente odds (elas mudam o tempo todo).
3. Campo que você não conseguiu confirmar via busca real vira "null" — nunca invente, estime ou "arredonde" um número que não achou.
4. Nunca arredonde ou simplifique uma odd encontrada — reproduza exatamente o valor da fonte.
5. Sempre que o esporte tiver "requisitos mínimos" listados abaixo, priorize a busca por esses dados especificamente — eles são usados por uma validação automática antes de o resultado seguir adiante.
6. Responda SOMENTE com um objeto JSON válido, sem markdown, sem comentários, sem texto antes ou depois, mesmo usando a ferramenta de busca.
`.trim();

/**
 * requisitosMinimos aqui espelha exatamente o mesmo array usado no front-end
 * (validarDadosMinimos) — mantido em sincronia manualmente. Se um dia mudar
 * de um lado, tem que mudar do outro.
 */
const ESPORTES = {
  futebol: {
    label: 'Futebol',
    liga_preferencial: 'ligas de pontos corridos (ex: Brasileirão, Premier League, MLS) — evite mata-mata/torneio quando possível',
    mercados: ['Gols (Over/Under)', 'Moneyline (1X2)', 'Handicap Asiático', 'Half Time / Full Time', 'Escanteios', 'Chutes a Gol', 'Cartões'],
    requisitosMinimos: ['forma_recente (últimas 5 partidas)', 'h2h (confrontos diretos)'],
    contrato: `
{
  "esporte": "futebol",
  "liga": "<string>",
  "casa": "<string>",
  "visitante": "<string>",
  "odds": {
    "gols_over_under": [{ "linha": <number>, "over": <number|null>, "under": <number|null> }],
    "moneyline_1x2": { "casa": <number|null>, "empate": <number|null>, "visitante": <number|null> },
    "handicap_asiatico": [{ "linha": <number>, "casa": <number|null>, "visitante": <number|null> }],
    "half_time_full_time": { "descricao": "<string|null>", "odds": <object|null> },
    "escanteios": { "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "chutes_a_gol": { "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "cartoes": { "linha": <number|null>, "over": <number|null>, "under": <number|null> }
  },
  "estatisticas": {
    "xg_casa": <number|null>, "xg_visitante": <number|null>,
    "xga_casa": <number|null>, "xga_visitante": <number|null>,
    "forma_recente": { "casa": "<string, últimos 5 resultados>", "visitante": "<string>" },
    "h2h": "<string, resumo dos confrontos diretos recentes>"
  },
  "contexto": {
    "resumo_casa": "<string, o que a casa espera do jogo>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"]
  },
  "sentimento_mercado": null
}`.trim(),
  },

  beisebol: {
    label: 'Beisebol (MLB)',
    liga_preferencial: 'MLB (temporada regular)',
    mercados: ['Runs (Total)', 'Moneyline', 'Handicap (Run Line)', 'Strikeouts', 'Outs Registrados', 'Hits'],
    requisitosMinimos: ['ERA ou WHIP do starting pitcher', 'K% (taxa de strikeout) dos rebatedores adversários'],
    contrato: `
{
  "esporte": "beisebol",
  "liga": "MLB",
  "casa": "<string>",
  "visitante": "<string>",
  "odds": {
    "runs_total": { "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "moneyline": { "casa": <number|null>, "visitante": <number|null> },
    "run_line": { "linha": <number|null>, "casa": <number|null>, "visitante": <number|null> },
    "strikeouts_pitcher": [{ "jogador": "<string>", "linha": <number|null>, "over": <number|null>, "under": <number|null> }],
    "outs_registrados": { "jogador": "<string|null>", "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "hits": [{ "jogador": "<string>", "linha": <number|null>, "over": <number|null>, "under": <number|null> }]
  },
  "estatisticas": {
    "era_titular_casa": <number|null>, "whip_titular_casa": <number|null>,
    "era_titular_visitante": <number|null>, "whip_titular_visitante": <number|null>,
    "k_pct_ataque_casa": <number|null>, "k_pct_ataque_visitante": <number|null>,
    "era_bullpen_casa": <number|null>, "era_bullpen_visitante": <number|null>
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "park_factor": "<string|null>",
    "clima": "<string|null>"
  },
  "sentimento_mercado": null
}`.trim(),
  },

  basquete: {
    label: 'Basquete (NBA)',
    liga_preferencial: 'NBA (temporada regular)',
    mercados: ['Moneyline', 'Handicap (Spread)', 'Totais (Over/Under)', 'Pontos', 'Rebotes', 'Assistências'],
    requisitosMinimos: ['pontos_por_jogo (últimos 10 jogos)', 'net_rating ou estatística de eficiência'],
    contrato: `
{
  "esporte": "basquete",
  "liga": "NBA",
  "casa": "<string>",
  "visitante": "<string>",
  "odds": {
    "moneyline": { "casa": <number|null>, "visitante": <number|null> },
    "handicap": { "linha": <number|null>, "casa": <number|null>, "visitante": <number|null> },
    "total_pontos": { "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "props_jogador": [{ "jogador": "<string>", "mercado": "pontos|rebotes|assistencias|pra", "linha": <number|null>, "over": <number|null>, "under": <number|null> }]
  },
  "estatisticas": {
    "pontos_por_jogo_casa": <number|null>, "pontos_por_jogo_visitante": <number|null>,
    "net_rating_casa": <number|null>, "net_rating_visitante": <number|null>,
    "pace_casa": <number|null>, "pace_visitante": <number|null>
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"]
  },
  "sentimento_mercado": null
}`.trim(),
  },

  wnba: {
    label: 'Basquete (WNBA)',
    liga_preferencial: 'WNBA (temporada regular)',
    mercados: ['Moneyline', 'Handicap (Spread)', 'Totais (Over/Under)', 'Pontos', 'Rebotes', 'Assistências'],
    requisitosMinimos: ['pontos_por_jogo (últimos 10 jogos)', 'net_rating ou estatística de eficiência'],
    // Mesma forma do basquete/NBA — cobertura de dados costuma ser mais fraca,
    // então a instrução extra abaixo (avisoCobertura) reforça honestidade com null.
    avisoCobertura:
      'A cobertura de estatísticas avançadas da WNBA é tipicamente mais fraca que a da NBA. Busque normalmente, mas é ESPERADO que mais campos fiquem null — isso não é falha sua, é registrar a realidade dos dados disponíveis.',
    contrato: `
{
  "esporte": "wnba",
  "liga": "WNBA",
  "casa": "<string>",
  "visitante": "<string>",
  "odds": {
    "moneyline": { "casa": <number|null>, "visitante": <number|null> },
    "handicap": { "linha": <number|null>, "casa": <number|null>, "visitante": <number|null> },
    "total_pontos": { "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "props_jogador": [{ "jogador": "<string>", "mercado": "pontos|rebotes|assistencias|pra", "linha": <number|null>, "over": <number|null>, "under": <number|null> }]
  },
  "estatisticas": {
    "pontos_por_jogo_casa": <number|null>, "pontos_por_jogo_visitante": <number|null>,
    "net_rating_casa": <number|null>, "net_rating_visitante": <number|null>,
    "pace_casa": <number|null>, "pace_visitante": <number|null>
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"]
  },
  "sentimento_mercado": null
}`.trim(),
  },

  nfl: {
    label: 'Futebol Americano (NFL)',
    liga_preferencial: 'NFL (temporada regular)',
    mercados: ['Moneyline', 'Spread', 'Total de Pontos', 'Props de Jogador'],
    requisitosMinimos: ['EPA/play (ofensivo e defensivo)', 'Success Rate'],
    avisoAmostra:
      'A NFL tem só ~17 jogos por temporada — "forma recente" aqui NUNCA deve ser janela de 10-15 jogos. Priorize as estatísticas mais atuais disponíveis da temporada corrente; se a temporada está no início, é aceitável e ESPERADO complementar com dado da temporada anterior — registre isso explicitamente em "contexto.observacao_amostra", nunca finja que a amostra é maior do que é.',
    contrato: `
{
  "esporte": "nfl",
  "liga": "NFL",
  "casa": "<string>",
  "visitante": "<string>",
  "odds": {
    "moneyline": { "casa": <number|null>, "visitante": <number|null> },
    "spread": { "linha": <number|null>, "casa": <number|null>, "visitante": <number|null> },
    "total_pontos": { "linha": <number|null>, "over": <number|null>, "under": <number|null> },
    "props_jogador": [{ "jogador": "<string>", "mercado": "<string>", "linha": <number|null>, "over": <number|null>, "under": <number|null> }]
  },
  "estatisticas": {
    "epa_play_ofensivo_casa": <number|null>, "epa_play_ofensivo_visitante": <number|null>,
    "epa_play_defensivo_casa": <number|null>, "epa_play_defensivo_visitante": <number|null>,
    "success_rate_casa": <number|null>, "success_rate_visitante": <number|null>
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"],
    "observacao_amostra": "<string, obrigatório: explica quantos jogos da temporada atual sustentam os números acima>"
  },
  "sentimento_mercado": null
}`.trim(),
  },
};

function montarSystemPromptEngine1(esporte) {
  const chave = String(esporte || '').trim().toLowerCase();
  const config = ESPORTES[chave];

  if (!config) {
    throw new Error(
      `Esporte não suportado no Engine 1: "${esporte}". Válidos: ${Object.keys(ESPORTES).join(', ')}.`
    );
  }

  const avisos = [config.avisoCobertura, config.avisoAmostra].filter(Boolean);

  return `
Você é o "Engine 1" do Moneyball — pesquisador quantitativo. Você recebe o nome
de uma partida e usa busca real (Google Search) para coletar odds atuais,
estatísticas avançadas e contexto — e devolve tudo estruturado em JSON,
no formato exato que o Engine 2 (etapa seguinte, cálculo de valor) espera ler.

ESPORTE: ${config.label}
LIGA/COMPETIÇÃO PREFERENCIAL: ${config.liga_preferencial}
MERCADOS DE INTERESSE: ${config.mercados.join(', ')}
REQUISITOS MÍNIMOS A PRIORIZAR NA BUSCA: ${config.requisitosMinimos.join(' | ')}

${LEIS_GERAIS}

${avisos.length ? `### AVISOS ESPECÍFICOS DESTE ESPORTE\n\n${avisos.join('\n\n')}\n` : ''}
### FORMATO DE SAÍDA OBRIGATÓRIO

Responda SOMENTE com este JSON (preencha com o que encontrou, use null para o que não confirmou):

${config.contrato}
`.trim();
}

module.exports = { montarSystemPromptEngine1, ESPORTES };
