'use strict';

/**
 * Config compartilhada por esporte — usada pelo Engine 2 (Groq, só label+mercados)
 * e futuramente pelo dashboard (margensSeguranca + requisitosMinimos, que hoje
 * só existem no app antigo). Fonte única de verdade — se mudar aqui, os dois
 * lados ficam em sincronia automaticamente.
 *
 * Migrado do app antigo (Moneyball Pro HTML) + expandido com wnba e nfl.
 */

const MODULES = {
  beisebol: {
    label: 'Beisebol',
    icon: 'fa-baseball',
    mercados: ['Runs (Total)', 'Moneyline', 'Handicap (Run Line)', 'Strikeouts', 'Outs Registrados', 'Hits'],
    margensSeguranca: {
      Moneyline: { valor: 5, unidade: '% de probabilidade implícita', comparacao: 'probabilidade implícita das odds vs. probabilidade real projetada' },
    },
    requisitosMinimos: [
      { label: 'ERA ou WHIP do Starting Pitcher', palavrasChave: ['era', 'whip'] },
      { label: 'Taxa de Strikeouts (K%) dos rebatedores adversários', palavrasChave: ['k%', 'strikeout', 'k _pct', 'k_pct'] },
    ],
  },

  futebol: {
    label: 'Futebol',
    icon: 'fa-futbol',
    mercados: ['Gols (Over/Under)', 'Moneyline (1X2)', 'Handicap Asiático', 'Half Time / Full Time', 'Escanteios', 'Chutes a Gol', 'Cartões'],
    margensSeguranca: {
      'Handicap Asiático': { valor: 0.25, unidade: 'gols de diferença vs. xG esperado', comparacao: 'linha do handicap vs. diferença de xG projetada entre os times' },
      'Gols (Over/Under)': { valor: 0.4, unidade: 'gols vs. média de xG total', comparacao: 'linha de gols vs. soma do xG projetado dos dois times' },
    },
    requisitosMinimos: [
      { label: 'Forma recente (últimas 5 partidas)', palavrasChave: ['forma_recente', 'forma recente', 'últimos 5', 'ultimas 5', 'últimas 5'] },
      { label: 'Confrontos diretos (H2H)', palavrasChave: ['h2h', 'confronto direto', 'confrontos diretos'] },
    ],
  },

  basquete: {
    label: 'Basquete (NBA)',
    icon: 'fa-basketball',
    mercados: ['Moneyline', 'Handicap (Spread)', 'Totais (Over/Under)', 'Pontos', 'Rebotes', 'Assistências'],
    margensSeguranca: {
      Moneyline: { valor: 5, unidade: 'pontos de Edge (diferença entre projeção de placar e a linha implícita)', comparacao: 'edge em pontos entre a projeção do sistema e o que o moneyline implica' },
      'Handicap (Spread)': { valor: 2.5, unidade: 'pontos (devido à volatilidade)', comparacao: 'linha do spread vs. diferença de pontos projetada' },
      'Totais (Over/Under)': { valor: 3.5, unidade: 'pontos de discrepância', comparacao: 'linha de totais vs. total de pontos projetado' },
    },
    requisitosMinimos: [
      { label: 'Média de pontos (últimos 10 jogos)', palavrasChave: ['pontos_por_jogo', 'pontos por jogo', 'ppg'] },
      { label: 'Net Rating ou estatística de eficiência', palavrasChave: ['net_rating', 'net rating', 'offensive_rating', 'defensive_rating', 'eficiencia', 'eficiência'] },
    ],
  },

  wnba: {
    label: 'Basquete (WNBA)',
    icon: 'fa-basketball',
    mercados: ['Moneyline', 'Handicap (Spread)', 'Totais (Over/Under)', 'Pontos', 'Rebotes', 'Assistências'],
    margensSeguranca: {
      Moneyline: { valor: 5, unidade: 'pontos de Edge (diferença entre projeção de placar e a linha implícita)', comparacao: 'edge em pontos entre a projeção do sistema e o que o moneyline implica' },
      'Handicap (Spread)': { valor: 2.5, unidade: 'pontos (devido à volatilidade)', comparacao: 'linha do spread vs. diferença de pontos projetada' },
      'Totais (Over/Under)': { valor: 3.5, unidade: 'pontos de discrepância', comparacao: 'linha de totais vs. total de pontos projetado' },
    },
    requisitosMinimos: [
      { label: 'Média de pontos (últimos 10 jogos)', palavrasChave: ['pontos_por_jogo', 'pontos por jogo', 'ppg'] },
      { label: 'Net Rating ou estatística de eficiência', palavrasChave: ['net_rating', 'net rating', 'offensive_rating', 'defensive_rating', 'eficiencia', 'eficiência'] },
    ],
  },

};

module.exports = { MODULES };
