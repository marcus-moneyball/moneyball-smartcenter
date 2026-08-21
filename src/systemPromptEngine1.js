'use strict';

/**
 * montarSystemPromptEngine1(esporte)
 *
 * Gera o System Prompt do "Engine 1" (Gemini, com Google Search grounding).
 * Responsabilidade do Engine 1: pesquisar, coletar e estruturar — NUNCA
 * calcular EV, probabilidade final, robustez, Game Script ou classificação
 * de valor. Isso é trabalho exclusivo do Engine 2 (Groq).
 *
 * Métricas alinhadas ao "Framework Mestre da Análise Esportiva de Elite"
 * do usuário — Engine 1 busca o CARDÁPIO de dados que o Engine 2 precisa
 * pra aplicar os 5 Pilares (Força, Matchup, Forma, Contexto, Ruído).
 */

const LEIS_GERAIS = `
### LEIS GERAIS DO ENGINE 1 (VALEM PARA QUALQUER ESPORTE)

1. Sua função é EXCLUSIVAMENTE pesquisa e estruturação. Você NUNCA calcula probabilidade, Expected Value, Game Script, matchup ou classificação de valor — isso é proibido aqui, é trabalho do Engine 2.
2. Use SEMPRE a busca do Google (grounding) para confirmar odds, estatísticas e contexto atuais — nunca responda com dado da sua memória interna sem confirmar.
3. Campo que você não conseguiu confirmar via busca real vira "null" — nunca invente, estime ou "arredonde" um número que não achou.
4. Nunca arredonde ou simplifique uma odd encontrada — reproduza exatamente o valor da fonte.
5. Busque a estatística na MELHOR janela disponível (idealmente 10-15 jogos recentes) — só isso, não precisa buscar em múltiplas janelas temporais separadas. Priorize velocidade: 1 boa busca por dado é melhor que 3 buscas incompletas.
6. Busque ATIVAMENTE por desfalques/lesões recentes (últimas 48h) dos dois times.
7. Busque ATIVAMENTE a probabilidade implícita em mercados de predição pública (ex: Polymarket) — se não encontrar mercado ativo pra esse jogo específico, "sentimento_mercado" fica null.
8. Responda SOMENTE com um objeto JSON válido, sem markdown, sem comentários, sem texto antes ou depois, mesmo usando a ferramenta de busca.

### EXCEÇÃO CONTROLADA: DETERMINAR O GAME SCRIPT (só quando o campo existir no contrato)

Isso é a ÚNICA interpretação permitida ao Engine 1. Depois de coletar as estatísticas,
classifique o roteiro provável do jogo em UMA destas categorias, baseado
EXCLUSIVAMENTE nos números que você mesmo coletou (nunca em opinião ou viés):

Baseie-se PRIORITARIAMENTE em xG/xGA (sempre disponíveis) — Field Tilt/PPDA são só reforço quando existirem, nunca bloqueiam a classificação se vierem null.

- **dominio_territorial**: xG e xGA muito desbalanceados entre os times (um ataca muito mais / defende muito melhor). Se tiver Field Tilt/PPDA, reforça a leitura, mas não é obrigatório.
- **eficiencia_cirurgica**: poucos volumes de criação dos dois lados, mas eficiência alta (xG por chute alto, xG total baixo).
- **transicao_caos**: PPDA baixo dos dois lados (pressão alta mútua) ou times com estilos de transição rápida.
- **desgaste_atrito**: sinais de fadiga/viagem/calendário apertado que sugerem jogo decidido tarde.

Nunca invente uma categoria fora dessas 4. Se os números não derem sinal claro pra nenhuma categoria específica, use "dominio_territorial" como padrão neutro e diga isso na justificativa (nunca deixe o campo vazio ou force uma leitura que os números não sustentam).
`.trim();

const ESPORTES = {
  futebol: {
    label: 'Futebol',
    liga_preferencial: 'ligas de pontos corridos (ex: Brasileirão, Premier League) — evite mata-mata/torneio quando possível',
    mercados: ['Gols (Over/Under)', 'Moneyline (1X2)', 'Handicap Asiático', 'Half Time / Full Time', 'Escanteios', 'Chutes a Gol', 'Cartões'],
    requisitosMinimos: ['xG e xGA (Expected Goals)', 'Field Tilt', 'PPDA'],
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
    "xg_casa": <number, OBRIGATÓRIO — pare e busque até achar>, "xg_visitante": <number, OBRIGATÓRIO>,
    "xga_casa": <number, OBRIGATÓRIO>, "xga_visitante": <number, OBRIGATÓRIO>,
    "field_tilt_casa": <number|null, opcional — só preencha se achar na mesma busca do xG, não abra busca extra só pra isso>, "field_tilt_visitante": <number|null>,
    "ppda_casa": <number|null, opcional, mesmo critério>, "ppda_visitante": <number|null>,
    "forma_recente": { "casa": "<string|null, opcional>", "visitante": "<string|null>" },
    "h2h": "<string|null, opcional>"
  },
  "contexto": {
    "resumo_casa": "<string, o que a casa espera do jogo>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"]
  },
  "game_script": {
    "roteiro": "<uma de: dominio_territorial | eficiencia_cirurgica | transicao_caos | desgaste_atrito>",
    "justificativa": "<string, 1-2 frases citando os NÚMEROS que sustentam essa leitura — ex: 'Field Tilt 68% vs 35% e PPDA 6.5 vs 16.0 indicam domínio territorial claro'>",
    "resumo_uma_frase": "<string, a história do jogo em 1 frase, no espírito de 'Time A vai encurralar Time B no campo de defesa...'>"
  },
  "sentimento_mercado": { "fonte": "<string, ex: polymarket|null>", "probabilidade_implicita_casa": <number 0-1|null>, "probabilidade_implicita_visitante": <number 0-1|null>, "probabilidade_implicita_empate": <number 0-1|null>, "url_mercado": "<string|null>", "observacao": "<string|null>" }
}`.trim(),
  },

  beisebol: {
    label: 'Beisebol (MLB)',
    liga_preferencial: 'MLB (temporada regular)',
    mercados: ['Runs (Total)', 'Moneyline', 'Handicap (Run Line)', 'Strikeouts', 'Outs Registrados', 'Hits'],
    requisitosMinimos: ['FIP/xFIP do starting pitcher', 'wRC+ e xwOBA do ataque adversário', 'BABIP (sinal de sorte/regressão)'],
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
    "era_titular_casa": <number|null>, "fip_titular_casa": <number|null>, "xfip_titular_casa": <number|null>,
    "era_titular_visitante": <number|null>, "fip_titular_visitante": <number|null>, "xfip_titular_visitante": <number|null>,
    "babip_titular_casa": <number|null, "média da liga ~.300 — abaixo é sorte insustentável">, "babip_titular_visitante": <number|null>,
    "wrc_plus_ataque_casa": <number|null>, "wrc_plus_ataque_visitante": <number|null>,
    "xwoba_ataque_casa": <number|null>, "xwoba_ataque_visitante": <number|null>,
    "platoon_split_relevante": "<string|null, ex: lineup visitante é fraco contra canhotos e o titular da casa é canhoto>",
    "vezes_enfrentando_lineup_hoje": "<string|null, ex: titular da casa geralmente cai de rendimento na 3ª vez enfrentando o mesmo lineup>",
    "era_bullpen_casa": <number|null>, "era_bullpen_visitante": <number|null>,
    "bullpen_uso_ultimos_3_dias": "<string|null, sinal de bullpen desgastado>"
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "park_factor": "<string|null>",
    "clima": "<string|null>"
  },
  "sentimento_mercado": { "fonte": "<string, ex: polymarket|null>", "probabilidade_implicita_casa": <number 0-1|null>, "probabilidade_implicita_visitante": <number 0-1|null>, "probabilidade_implicita_empate": <number 0-1|null>, "url_mercado": "<string|null>", "observacao": "<string|null>" }
}`.trim(),
  },

  basquete: {
    label: 'Basquete (NBA)',
    liga_preferencial: 'NBA (temporada regular)',
    mercados: ['Moneyline', 'Handicap (Spread)', 'Totais (Over/Under)', 'Pontos', 'Rebotes', 'Assistências'],
    requisitosMinimos: ['Net Rating (ORtg - DRtg)', 'Pace', 'eFG%, TOV%, ORB% (4 Fatores)'],
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
    "net_rating_casa": <number|null>, "net_rating_visitante": <number|null>,
    "pace_casa": <number|null>, "pace_visitante": <number|null>,
    "efg_pct_casa": <number|null, "55%+ = elite">, "efg_pct_visitante": <number|null>,
    "tov_pct_casa": <number|null>, "tov_pct_visitante": <number|null>,
    "orb_pct_casa": <number|null>, "orb_pct_visitante": <number|null>,
    "pontos_por_jogo_casa": <number|null>, "pontos_por_jogo_visitante": <number|null>,
    "back_to_back_casa": <boolean|null>, "back_to_back_visitante": <boolean|null>
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"]
  },
  "sentimento_mercado": { "fonte": "<string, ex: polymarket|null>", "probabilidade_implicita_casa": <number 0-1|null>, "probabilidade_implicita_visitante": <number 0-1|null>, "probabilidade_implicita_empate": <number 0-1|null>, "url_mercado": "<string|null>", "observacao": "<string|null>" }
}`.trim(),
  },

  wnba: {
    label: 'Basquete (WNBA)',
    liga_preferencial: 'WNBA (temporada regular)',
    mercados: ['Moneyline', 'Handicap (Spread)', 'Totais (Over/Under)', 'Pontos', 'Rebotes', 'Assistências'],
    requisitosMinimos: ['Net Rating (ORtg - DRtg)', 'Pace', 'eFG%, TOV%, ORB% (4 Fatores)'],
    avisoCobertura:
      'A cobertura de estatísticas avançadas da WNBA é tipicamente mais fraca que a da NBA. Busque normalmente, mas é ESPERADO que mais campos fiquem null.',
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
    "net_rating_casa": <number|null>, "net_rating_visitante": <number|null>,
    "pace_casa": <number|null>, "pace_visitante": <number|null>,
    "efg_pct_casa": <number|null>, "efg_pct_visitante": <number|null>,
    "tov_pct_casa": <number|null>, "tov_pct_visitante": <number|null>,
    "orb_pct_casa": <number|null>, "orb_pct_visitante": <number|null>,
    "pontos_por_jogo_casa": <number|null>, "pontos_por_jogo_visitante": <number|null>,
    "back_to_back_casa": <boolean|null>, "back_to_back_visitante": <boolean|null>
  },
  "contexto": {
    "resumo_casa": "<string>",
    "resumo_visitante": "<string>",
    "desfalques_casa": ["<string>"],
    "desfalques_visitante": ["<string>"]
  },
  "sentimento_mercado": { "fonte": "<string, ex: polymarket|null>", "probabilidade_implicita_casa": <number 0-1|null>, "probabilidade_implicita_visitante": <number 0-1|null>, "probabilidade_implicita_empate": <number 0-1|null>, "url_mercado": "<string|null>", "observacao": "<string|null>" }
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
estatísticas avançadas e contexto — e devolve tudo estruturado em JSON, no
formato exato que o Engine 2 (etapa seguinte, aplica o Framework de Análise
de Elite) espera ler.

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
