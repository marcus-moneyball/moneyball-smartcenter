'use strict';

const db = require('./db');
const { montarSystemPromptEngine1 } = require('./systemPromptEngine1');
const { montarSystemPromptContextoQualitativo } = require('./systemPromptContextoQualitativo');
const { montarSystemPromptEngine2 } = require('./systemPromptEngine2');
const { montarSystemPromptEngine2Narrador } = require('./systemPromptEngine2Narrador');
const { chamarGeminiComRetry } = require('./geminiService');
const { chamarGroqComRetry } = require('./groqService');
const { MODULES } = require('./sportModules');
const { publicarPalpiteNoGhost } = require('./ghostService');

function mapearEsporte(fixture) {
  return fixture.esporte;
}

function baseUrlBackend() {
  return process.env.QUANT_BASE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
}

async function chamarMotorQuantFutebol(payload) {
  const baseUrl = baseUrlBackend();
  if (!baseUrl) {
    throw new Error('Não foi possível determinar a URL do backend (configure QUANT_BASE_URL nas env vars).');
  }

  const resposta = await fetch(`${baseUrl}/api/quant/futebol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
    body: JSON.stringify(payload),
  });

  const dados = await resposta.json();
  if (!resposta.ok || !dados.sucesso) {
    throw new Error(dados.erro || `Motor quant retornou HTTP ${resposta.status}`);
  }
  return dados;
}

/**
 * Fluxo NOVO — futebol (com motor quant Python):
 *   Engine 1 (Gemini, busca completa: odds+estatísticas+game_script)
 *     → Motor Quant Python (Poisson: probabilidade/edge/unidades/bilhete)
 *     → Engine 2 Narrador (Groq só escreve texto em cima dos números prontos)
 */
async function analisarFutebolComQuant(fixture, opcoes, inicio) {
  let resultadoEngine1;
  try {
    resultadoEngine1 = await chamarGeminiComRetry({
      apiKey: opcoes.geminiApiKey || process.env.GEMINI_API_KEY,
      systemPrompt: montarSystemPromptEngine1('futebol'),
      payload: { casa: fixture.time_casa, visitante: fixture.time_visitante, liga: fixture.liga_nome },
      usarGrounding: true,
    });
  } catch (erro) {
    return { sucesso: false, etapa: 'engine1_chamada', erros: [erro.message], tempo_ms: Date.now() - inicio };
  }

  if (resultadoEngine1.parseError || !resultadoEngine1.parsed) {
    return {
      sucesso: false,
      etapa: 'engine1_parse',
      erros: [`JSON inválido do Engine 1: ${resultadoEngine1.parseError}`],
      resposta_bruta: resultadoEngine1.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  const dadosEngine1 = resultadoEngine1.parsed;

  let resultadoQuant;
  try {
    resultadoQuant = await chamarMotorQuantFutebol({
      esporte: 'futebol',
      estatisticas: dadosEngine1.estatisticas,
      odds: dadosEngine1.odds,
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'motor_quant',
      erros: [erro.message],
      engine1_output: dadosEngine1,
      tempo_ms: Date.now() - inicio,
    };
  }

  let resultadoGroq;
  try {
    resultadoGroq = await chamarGroqComRetry({
      apiKey: opcoes.groqApiKey || process.env.GROQ_API_KEY,
      systemPrompt: montarSystemPromptEngine2Narrador(),
      conteudoUsuario: {
        game_script: dadosEngine1.game_script,
        mercados_calculados: resultadoQuant.mercados_calculados,
        bilhete_recomendado: resultadoQuant.bilhete_recomendado,
      },
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'engine2_narrador_chamada',
      erros: [erro.message],
      quant_output: resultadoQuant,
      tempo_ms: Date.now() - inicio,
    };
  }

  if (resultadoGroq.parseError || !resultadoGroq.parsed) {
    return {
      sucesso: false,
      etapa: 'engine2_narrador_parse',
      erros: [`JSON inválido do Groq: ${resultadoGroq.parseError}`],
      resposta_bruta: resultadoGroq.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  return {
    sucesso: true,
    esporte: 'futebol',
    casa: fixture.time_casa,
    visitante: fixture.time_visitante,
    liga: fixture.liga_nome,
    game_script: dadosEngine1.game_script,
    resumo_tecnico: resultadoGroq.parsed.resumo_tecnico ?? null,
    analise_completa: resultadoGroq.parsed.analise_completa ?? [],
  };
}

/**
 * Fluxo ANTIGO — basquete/beisebol (ainda sem motor quant próprio):
 * Gemini busca só contexto qualitativo + Groq calcula tudo (como antes).
 *
 * ATENÇÃO — pendência conhecida: fixture.oddsAtuais/statsCasa/statsVisitante
 * vêm do banco (odds_snapshots/team_stats), tabelas que só a API-Sports
 * preenchia — e não usamos mais ela. Pra esses dois esportes, isso hoje
 * provavelmente vem vazio. Corrigir isso é o próximo passo (mesma solução
 * do futebol: Gemini busca tudo, ou casar com odds_api_snapshots por nome).
 */
async function analisarComGroqCalculando(fixture, esporte, opcoes, inicio) {
  const modulo = MODULES[esporte];

  let resultadoQualitativo;
  try {
    resultadoQualitativo = await chamarGeminiComRetry({
      apiKey: opcoes.geminiApiKey || process.env.GEMINI_API_KEY,
      systemPrompt: montarSystemPromptContextoQualitativo(),
      payload: { casa: fixture.time_casa, visitante: fixture.time_visitante, liga: fixture.liga_nome },
      usarGrounding: true,
    });
  } catch (erro) {
    return { sucesso: false, etapa: 'contexto_qualitativo', erros: [erro.message], tempo_ms: Date.now() - inicio };
  }

  if (resultadoQualitativo.parseError || !resultadoQualitativo.parsed) {
    return {
      sucesso: false,
      etapa: 'contexto_qualitativo_parse',
      erros: [`JSON inválido do contexto qualitativo: ${resultadoQualitativo.parseError}`],
      resposta_bruta: resultadoQualitativo.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  const contexto = resultadoQualitativo.parsed;

  const payloadParaGroq = {
    esporte,
    liga: fixture.liga_nome,
    casa: fixture.time_casa,
    visitante: fixture.time_visitante,
    odds: fixture.oddsAtuais,
    estatisticas: { casa: fixture.statsCasa, visitante: fixture.statsVisitante },
    resumo_casa: contexto.resumo_casa,
    resumo_visitante: contexto.resumo_visitante,
    desfalques_casa: contexto.desfalques_casa,
    desfalques_visitante: contexto.desfalques_visitante,
    sentimento_mercado: contexto.sentimento_mercado,
  };

  let resultadoGroq;
  try {
    resultadoGroq = await chamarGroqComRetry({
      apiKey: opcoes.groqApiKey || process.env.GROQ_API_KEY,
      systemPrompt: montarSystemPromptEngine2(modulo),
      conteudoUsuario: payloadParaGroq,
    });
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'engine2_chamada',
      erros: [erro.message],
      payload_engine1: payloadParaGroq,
      tempo_ms: Date.now() - inicio,
    };
  }

  if (resultadoGroq.parseError || !resultadoGroq.parsed) {
    return {
      sucesso: false,
      etapa: 'engine2_parse',
      erros: [`JSON inválido do Groq: ${resultadoGroq.parseError}`],
      resposta_bruta: resultadoGroq.raw,
      tempo_ms: Date.now() - inicio,
    };
  }

  return {
    sucesso: true,
    esporte,
    casa: fixture.time_casa,
    visitante: fixture.time_visitante,
    liga: fixture.liga_nome,
    resumo_tecnico: resultadoGroq.parsed.resumo_tecnico ?? null,
    analise_completa: resultadoGroq.parsed.analise_completa ?? [],
  };
}

/**
 * analisarEPublicarFixture(fixtureId)
 * Roteia pro fluxo certo por esporte, depois publica no Ghost.
 */
async function analisarEPublicarFixture(fixtureId, opcoes = {}) {
  const inicio = Date.now();

  const fixture = await db.obterFixturePorId(fixtureId);
  if (!fixture) {
    return { sucesso: false, etapa: 'busca_fixture', erros: [`Fixture ${fixtureId} não encontrado no banco.`] };
  }

  const esporte = mapearEsporte(fixture);

  const resultadoAnalise =
    esporte === 'futebol'
      ? await analisarFutebolComQuant(fixture, opcoes, inicio)
      : await analisarComGroqCalculando(fixture, esporte, opcoes, inicio);

  if (!resultadoAnalise.sucesso) {
    return resultadoAnalise;
  }

  let publicacao;
  try {
    publicacao = await publicarPalpiteNoGhost(resultadoAnalise);
  } catch (erro) {
    return {
      sucesso: false,
      etapa: 'publicacao_ghost',
      erros: [erro.message],
      analise: resultadoAnalise,
      tempo_ms: Date.now() - inicio,
    };
  }

  await db.marcarFixtureAprovado(fixtureId, true);

  try {
    await db.salvarPalpitesPublicados(fixture, esporte, resultadoAnalise.analise_completa || [], publicacao);
  } catch (erro) {
    // Falha ao salvar rastreamento nunca deve derrubar a publicação que já aconteceu —
    // só loga, o Ghost já tem o post de verdade.
    // eslint-disable-next-line no-console
    console.warn('[analiserFixture] falha ao salvar palpites_publicados:', erro.message);
  }

  return {
    sucesso: true,
    etapa: 'concluido',
    fixture_id: fixtureId,
    analise: resultadoAnalise,
    publicacao,
    tempo_ms: Date.now() - inicio,
  };
}

module.exports = { analisarEPublicarFixture };
