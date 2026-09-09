'use strict';

/**
 * Traduz o JSON do Moneyball Nexus (investigação qualitativa: evidências,
 * hipóteses, assimetrias -- SEM nenhum número de mercado, por desenho) em:
 *   1. fatores_incerteza no formato que o Pro já consome
 *      (calcular_nivel_confianca_dados) -- mesmo mecanismo usado antes.
 *   2. um resumo narrativo pronto pra alimentar o Groq na hora de escrever
 *      o artigo -- aproveita a narrativa já lapidada pelo Nexus em vez de
 *      pedir pro Groq inventar contexto do zero.
 *
 * Pura transformação de JS -- SEM chamada de IA aqui. O trabalho caro
 * (investigar de verdade) já foi feito manualmente por você antes de colar.
 *
 * Schema de referência: Moneyball Nexus (Futebol/MLB/NBA-WNBA) v2.0.
 * `contexto_interpretado` e `gate` são campos do TOPO do JSON (compartilhados
 * por analise_coletiva e todos os itens de analises_prop), não de cada bloco.
 */

const MAPA_INTENSIDADE = { alta: 'high', media: 'medium', baixa: 'low' };

/**
 * Extrai fatores + narrativa de UM bloco de análise (analise_coletiva OU
 * um item de analises_prop -- mesmo formato nos dois).
 */
function extrairDeUmBloco(bloco) {
  if (!bloco) return { fatoresIncerteza: [], resumoNarrativo: '', temCenarioDefinido: false };

  const temCenarioDefinido = bloco.resultado_principal?.cenario_definido !== false;

  const fatoresIncerteza = (bloco.assimetrias || []).map((a) => ({
    tipo: a.tipo,
    descricao: `${a.alvo || ''}: ${(a.evidencias || []).join('; ')}`.trim(),
    impact_level: MAPA_INTENSIDADE[a.intensidade] || 'medium',
  }));

  const partesNarrativa = [
    bloco.narrativa?.cenario_provavel,
    bloco.narrativa?.porque_os_dados_apontam_para_isso,
  ].filter(Boolean);

  return {
    fatoresIncerteza,
    resumoNarrativo: temCenarioDefinido
      ? partesNarrativa.join(' ')
      : `Evidências insuficientes para um cenário definido (${bloco.resultado_principal?.motivo_indefinicao || 'motivo não especificado'}).`,
    temCenarioDefinido,
  };
}

/**
 * Fator de contexto compartilhado (desfalques/clima) -- vem do topo do
 * JSON, aplicado à análise coletiva (não faz sentido replicar em cada prop).
 */
function extrairFatorDeContexto(contextoInterpretado) {
  if (!contextoInterpretado) return null;
  const impacto = contextoInterpretado.impacto_desfalques;
  if (!impacto || impacto === 'baixo') return null;

  return {
    tipo: 'desfalques',
    descricao: contextoInterpretado.detalhes_contexto || 'Desfalque relevante identificado.',
    impact_level: MAPA_INTENSIDADE[impacto] || 'medium',
  };
}

/**
 * @param {Object} nexusJson - o JSON completo devolvido pelo Nexus (Futebol/MLB/NBA-WNBA)
 * @returns {{
 *   coletivo: { fatoresIncerteza, resumoNarrativo, temCenarioDefinido },
 *   props: Object<string, { fatoresIncerteza, resumoNarrativo, temCenarioDefinido }>,
 *   confiavel: boolean  -- gate.dados_minimos do topo do JSON
 * }}
 */
function interpretarNexus(nexusJson) {
  if (!nexusJson) return { coletivo: extrairDeUmBloco(null), props: {}, confiavel: false };

  const coletivo = extrairDeUmBloco(nexusJson.analise_coletiva);

  const fatorContexto = extrairFatorDeContexto(nexusJson.contexto_interpretado);
  if (fatorContexto) coletivo.fatoresIncerteza.push(fatorContexto);

  const props = {};
  for (const item of nexusJson.analises_prop || []) {
    const chave = item.alvo?.jogador_ou_estatistica || item.alvo?.time;
    if (chave) props[chave] = extrairDeUmBloco(item);
  }

  // gate é do TOPO do JSON -- vale pra investigação inteira, não por bloco.
  const confiavel = nexusJson.gate?.dados_minimos !== false;

  return { coletivo, props, confiavel };
}

module.exports = { interpretarNexus };
