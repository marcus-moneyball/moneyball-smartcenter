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
