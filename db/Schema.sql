-- Schema do banco compartilhado do ecossistema Moneyball.
-- Filosofia: este banco é só ARMAZENAMENTO ESTRUTURADO — nenhum cálculo de
-- GLV/Odd Justa acontece aqui. odds_snapshots guarda cada leitura de odds ao
-- longo do tempo (não só a mais recente), pra qualquer app consumidor
-- calcular abertura-vs-atual com uma query simples.

CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  api_sports_id INTEGER UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  pais TEXT,
  pontos_corridos BOOLEAN NOT NULL DEFAULT true,
  habilitada BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  api_sports_id INTEGER UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  liga_id INTEGER REFERENCES leagues(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fixtures (
  id SERIAL PRIMARY KEY,
  api_sports_id INTEGER UNIQUE NOT NULL,
  liga_id INTEGER NOT NULL REFERENCES leagues(id),
  time_casa_id INTEGER NOT NULL REFERENCES teams(id),
  time_visitante_id INTEGER NOT NULL REFERENCES teams(id),
  temporada INTEGER,
  data_hora TIMESTAMPTZ NOT NULL,
  status TEXT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fixtures_data_hora ON fixtures (data_hora);
CREATE INDEX IF NOT EXISTS idx_fixtures_liga ON fixtures (liga_id);

-- Cada linha é UMA leitura de odds num instante — nunca sobrescrita, só inserida.
-- "abertura" = a linha com menor capturado_em por fixture+mercado+selecao;
-- "atual" = a linha com maior capturado_em. Isso é responsabilidade de quem
-- consome (query com MIN/MAX ou DISTINCT ON), não deste schema.
CREATE TABLE IF NOT EXISTS odds_snapshots (
  id BIGSERIAL PRIMARY KEY,
  fixture_id INTEGER NOT NULL REFERENCES fixtures(id),
  mercado TEXT NOT NULL,
  selecao TEXT NOT NULL,
  valor NUMERIC(6, 3) NOT NULL,
  capturado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  origem TEXT NOT NULL DEFAULT 'api-sports' -- permite outro app inserir com origem diferente
);

CREATE INDEX IF NOT EXISTS idx_odds_fixture ON odds_snapshots (fixture_id, mercado, selecao, capturado_em);

-- Estatísticas de time, cacheadas — evita gastar cota da API-Sports
-- re-buscando estatística de um time que não mudou desde ontem.
CREATE TABLE IF NOT EXISTS team_stats (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  temporada INTEGER NOT NULL,
  dados JSONB NOT NULL, -- payload cru relevante da API-Sports, sem reformatar
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, temporada)
);

-- Log de consumo de cota — pra nunca estourar as 100 req/dia sem perceber.
CREATE TABLE IF NOT EXISTS api_sports_uso_diario (
  data DATE PRIMARY KEY,
  requisicoes_usadas INTEGER NOT NULL DEFAULT 0,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reservado pra quando o outro app (cálculo de GLV) precisar marcar
-- quais partidas passaram no filtro — a coluna já existe, mas ninguém
-- escreve nela ainda nesta etapa.
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS aprovado_glv BOOLEAN;

-- Tabela recebida do colaborador (Léo) — "Janela de Verdade" (L10/L15) por
-- time, usada por outro app do ecossistema. Diferente de team_stats acima:
-- aqui é média já calculada (não JSONB cru), chaveada por NOME de time (não
-- FK), pra funcionar mesmo com apps que leem nome de time via OCR/print.
-- Populada por coletaNoturna.js (ver nota no código) — nunca por um job
-- separado, pra não duplicar consumo da cota da API-Sports.
CREATE TABLE IF NOT EXISTS team_season_stats (
    id              SERIAL PRIMARY KEY,
    time_nome       TEXT NOT NULL,
    esporte         TEXT NOT NULL,
    competicao      TEXT,
    janela          TEXT NOT NULL DEFAULT 'L10',
    amostra_n       INTEGER NOT NULL,
    media_marcada   NUMERIC NOT NULL,
    media_sofrida   NUMERIC NOT NULL,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (time_nome, esporte, competicao, janela)
);
CREATE INDEX IF NOT EXISTS idx_team_stats_busca
    ON team_season_stats (time_nome, esporte);

-- ============================================================
-- MIGRAÇÃO: suporte multi-esporte (futebol/basquete/beisebol na
-- API-Sports são produtos separados, com IDs que podem colidir entre si —
-- api_sports_id sozinho não é mais único, precisa vir acompanhado do esporte).
-- Rode isto depois das CREATE TABLE acima, é seguro rodar mais de uma vez.
-- ============================================================

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS esporte TEXT NOT NULL DEFAULT 'futebol';
ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_api_sports_id_key;
DO $$ BEGIN
  ALTER TABLE leagues ADD CONSTRAINT leagues_esporte_api_sports_id_key UNIQUE (esporte, api_sports_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS esporte TEXT NOT NULL DEFAULT 'futebol';
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_api_sports_id_key;
DO $$ BEGIN
  ALTER TABLE teams ADD CONSTRAINT teams_esporte_api_sports_id_key UNIQUE (esporte, api_sports_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS esporte TEXT NOT NULL DEFAULT 'futebol';
ALTER TABLE fixtures DROP CONSTRAINT IF EXISTS fixtures_api_sports_id_key;
DO $$ BEGIN
  ALTER TABLE fixtures ADD CONSTRAINT fixtures_esporte_api_sports_id_key UNIQUE (esporte, api_sports_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE api_sports_uso_diario ADD COLUMN IF NOT EXISTS esporte TEXT NOT NULL DEFAULT 'futebol';
ALTER TABLE api_sports_uso_diario DROP CONSTRAINT IF EXISTS api_sports_uso_diario_pkey;
DO $$ BEGIN
  ALTER TABLE api_sports_uso_diario ADD PRIMARY KEY (data, esporte);
EXCEPTION WHEN invalid_table_definition THEN NULL; END $$;

-- ============================================================
-- Banco de odds via The Odds API — tabela própria, sem tentar casar com
-- fixtures da API-Sports (provedores diferentes, IDs diferentes). Casar por
-- time_casa/time_visitante/comeca_em é responsabilidade de quem consome.
-- ============================================================
CREATE TABLE IF NOT EXISTS odds_api_snapshots (
  id BIGSERIAL PRIMARY KEY,
  sport_key TEXT NOT NULL,       -- ex: "soccer_brazil_campeonato", "basketball_nba"
  evento_id TEXT NOT NULL,       -- id do evento na The Odds API
  time_casa TEXT NOT NULL,
  time_visitante TEXT NOT NULL,
  comeca_em TIMESTAMPTZ,
  bookmaker TEXT NOT NULL,
  mercado TEXT NOT NULL,
  selecao TEXT NOT NULL,
  valor NUMERIC(6, 3) NOT NULL,
  capturado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odds_api_evento ON odds_api_snapshots (evento_id, capturado_em);
CREATE INDEX IF NOT EXISTS idx_odds_api_times ON odds_api_snapshots (time_casa, time_visitante, comeca_em);

-- ============================================================
-- Rastreamento de palpites publicados — base pro "5 do dia" e ROI mensal.
-- Uma linha por mercado publicado (não por jogo — um jogo pode gerar
-- várias linhas se vários mercados dele foram publicados).
-- ============================================================
CREATE TABLE IF NOT EXISTS palpites_publicados (
  id BIGSERIAL PRIMARY KEY,
  fixture_id INTEGER REFERENCES fixtures(id),
  esporte TEXT NOT NULL,
  liga TEXT,
  casa TEXT NOT NULL,
  visitante TEXT NOT NULL,
  mercado TEXT NOT NULL,
  aposta_sugerida TEXT,
  odd NUMERIC(6, 3),
  bet_to NUMERIC(6, 3),
  probabilidade_estimada NUMERIC(6, 4),
  probabilidade_implicita NUMERIC(6, 4),
  edge NUMERIC(6, 4),
  unidades_recomendadas NUMERIC(3, 1),
  no_bilhete_final BOOLEAN DEFAULT false,
  resultado TEXT NOT NULL DEFAULT 'pendente', -- pendente | ganhou | perdeu | push
  ghost_post_id TEXT,
  ghost_url TEXT,
  publicado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  resultado_atualizado_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_palpites_data ON palpites_publicados (publicado_em);
CREATE INDEX IF NOT EXISTS idx_palpites_resultado ON palpites_publicados (resultado);
