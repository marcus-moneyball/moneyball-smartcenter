'use strict';

/**
 * Notificação simples via Telegram Bot API. Existe porque o plano Hobby da
 * Vercel só guarda Runtime Logs por 1 hora -- sem isso, qualquer execução
 * do cron fora dessa janela vira uma caixa-preta. Fail-open: se o Telegram
 * falhar, só loga aviso, nunca derruba a execução do cron por causa disso.
 */
async function enviarTelegram(texto) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn('[TELEGRAM] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não configurados -- pulando notificação.');
    return;
  }

  try {
    const resposta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      console.warn(`[TELEGRAM] Falha ao enviar (${resposta.status}): ${corpo.slice(0, 200)}`);
    }
  } catch (erro) {
    console.warn(`[TELEGRAM] Falha ao enviar (fail-open): ${erro.message}`);
  }
}

/**
 * Monta e envia o resumo de uma execução bem-sucedida do cron (mesmo que
 * "sucedida" só signifique "rodou sem crashar", inclusive com 0 aprovados).
 */
async function notificarResumoExecucao({ nomeEsporte, tempoMs, resumo, publicacao }) {
  const linhas = [
    `*${nomeEsporte}* -- ${new Date().toLocaleDateString('pt-BR')}`,
    `Coletadas: ${resumo.total_coletado} | Aprovadas: ${resumo.aprovados_filtro_qualidade} | Publicadas: ${resumo.jogos_processados_com_sucesso}`,
    `Tempo: ${(tempoMs / 1000).toFixed(1)}s`,
  ];

  if (publicacao?.url) {
    linhas.push(`📰 ${publicacao.url}`);
  } else if (resumo.aprovados_filtro_qualidade === 0) {
    linhas.push('Nenhuma seleção com vantagem real hoje -- sem publicação (isso é esperado, não é erro).');
  }

  if (resumo.jogos_com_falha_na_gemini?.length) {
    linhas.push(`⚠️ ${resumo.jogos_com_falha_na_gemini.length} partida(s) aprovada(s) falharam no processamento -- ver detalhe no resumo da API.`);
  }

  await enviarTelegram(linhas.join('\n'));
}

/**
 * Notifica quando o cron inteiro quebra (erro não tratado) -- esse é o
 * caso que mais importa avisar rápido, já que sem isso o log de 1h some.
 */
async function notificarErroExecucao({ nomeEsporte, erro }) {
  await enviarTelegram(`🔴 *${nomeEsporte}* -- erro na execução do cron:\n${erro.slice(0, 500)}`);
}

module.exports = { notificarResumoExecucao, notificarErroExecucao };
