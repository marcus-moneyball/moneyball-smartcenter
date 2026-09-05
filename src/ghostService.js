'use strict';

const GhostAdminAPI = require('@tryghost/admin-api');

/**
 * Publica o relatório da rodada como post no Ghost.
 * Responsabilidade única: publicar. Nunca decide SE deve publicar
 * (isso é decidido antes, no orquestrador do cron) nem formata conteúdo
 * (relatorioBuilder já entrega HTML pronto, estilizado).
 *
 * Requer as env vars: GHOST_API_URL, GHOST_ADMIN_API_KEY
 *
 * Configuráveis via env var (opcionais):
 *   GHOST_POST_STATUS: 'draft' (padrão) | 'published'
 *   GHOST_POST_VISIBILITY: 'public' (padrão) | 'members' | 'paid'
 *
 * ATENÇÃO: GHOST_POST_STATUS=published remove a revisão manual antes de
 * ir ao ar -- só ative depois de confiar na qualidade das seleções ao
 * longo de alguns dias de rascunho.
 */
function criarClienteGhost() {
  const url = process.env.GHOST_API_URL;
  const key = process.env.GHOST_ADMIN_API_KEY;

  if (!url || !key) {
    throw new Error('GHOST_API_URL e/ou GHOST_ADMIN_API_KEY ausentes nas variáveis de ambiente.');
  }

  return new GhostAdminAPI({ url, key, version: 'v5.0' });
}

/**
 * publicarRelatorioNoGhost({ titulo, html })
 * @returns {Promise<{ id: string, url: string }>}
 */
async function publicarRelatorioNoGhost({ titulo, html }, opcoes = {}) {
  const api = criarClienteGhost();

  const post = await api.posts.add(
    {
      title: titulo,
      html,
      status: opcoes.status || process.env.GHOST_POST_STATUS || 'draft', // draft por padrão — publish é decisão explícita
      visibility: opcoes.visibility || process.env.GHOST_POST_VISIBILITY || 'public',
      tags: opcoes.tags || ['relatorio-rodada'],
    },
    { source: 'html' }
  );

  return { id: post.id, url: post.url };
}

module.exports = { publicarRelatorioNoGhost };
