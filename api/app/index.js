'use strict';

const HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Moneyball Radar</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 800px; margin: 24px auto; padding: 0 16px; color: #111827; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin-top: 32px; border-bottom: 1px solid #E5E7EB; padding-bottom: 8px; }
  .jogo { border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .jogo h3 { margin: 0 0 8px 0; font-size: 15px; }
  .mercados { font-size: 13px; color: #6B7280; margin-bottom: 8px; }
  button { background: #111827; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  button:disabled { background: #9CA3AF; cursor: not-allowed; }
  input[type=file] { font-size: 13px; }
  select, textarea { width: 100%; font-family: monospace; font-size: 12px; padding: 8px; border-radius: 6px; border: 1px solid #D1D5DB; }
  textarea { height: 200px; }
  .status { font-size: 13px; margin-top: 8px; }
  .status.ok { color: #059669; }
  .status.erro { color: #DC2626; }
  .resumo-nexus { background: #F9FAFB; padding: 10px; border-radius: 6px; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
  <h1>Moneyball Radar</h1>

  <h2>1. Prints de odds da rodada</h2>
  <input type="file" id="inputOdds" accept="image/*" multiple>
  <button id="btnTriagem">Rodar Radar</button>
  <div id="statusTriagem" class="status"></div>

  <div id="jogos"></div>

  <script>
    const estado = { jogos: [] };
    let SENHA_APP = sessionStorage.getItem('senhaApp') || '';

    function garantirSenha() {
      if (!SENHA_APP) {
        SENHA_APP = prompt('Senha do app:') || '';
        sessionStorage.setItem('senhaApp', SENHA_APP);
      }
      return SENHA_APP;
    }

    async function chamarApi(caminho, corpo) {
      const resposta = await fetch(caminho, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-App-Senha': garantirSenha() },
        body: JSON.stringify(corpo),
      });
      if (resposta.status === 401) {
        sessionStorage.removeItem('senhaApp'); // senha errada -- limpa pra pedir de novo na próxima
        throw new Error('Senha incorreta.');
      }
      return resposta.json();
    }

    function paraBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function mapearEsporte(sportKeyOuLiga) {
      const s = (sportKeyOuLiga || '').toLowerCase();
      if (s.includes('nba') || s.includes('wnba') || s.includes('basquete')) return 'nba_wnba';
      if (s.includes('mlb') || s.includes('beisebol')) return 'mlb';
      return 'futebol';
    }

    document.getElementById('btnTriagem').addEventListener('click', async () => {
      const arquivos = document.getElementById('inputOdds').files;
      const statusEl = document.getElementById('statusTriagem');
      if (!arquivos.length) { statusEl.textContent = 'Selecione ao menos um print.'; statusEl.className = 'status erro'; return; }

      statusEl.textContent = 'Rodando Radar...'; statusEl.className = 'status';
      try {
        const imagens = await Promise.all([...arquivos].map(async (f) => ({ data: await paraBase64(f), mimeType: f.type })));
        const dados = await chamarApi('/api/app/triagem', { imagens });
        if (!dados.sucesso) throw new Error(dados.erro);

        estado.jogos = [];
        const picks = dados.radar.picks_by_sport || {};
        for (const esporteKey of Object.keys(picks)) {
          for (const jogo of picks[esporteKey]) {
            estado.jogos.push({
              confronto: { match: jogo.match, league: jogo.league },
              mercados_visiveis_no_print: jogo.mercados_visiveis_no_print,
              contexto_ocr: jogo.contexto_ocr,
              esporte: mapearEsporte(jogo.league || esporteKey),
              nexus: null,
            });
          }
        }
        statusEl.textContent = estado.jogos.length + ' jogo(s) escolhido(s).'; statusEl.className = 'status ok';
        renderizarJogos();
      } catch (e) {
        statusEl.textContent = 'Erro: ' + e.message; statusEl.className = 'status erro';
      }
    });

    function renderizarJogos() {
      const container = document.getElementById('jogos');
      container.innerHTML = '<h2>2. Investigar cada jogo</h2>';

      estado.jogos.forEach((jogo, i) => {
        const div = document.createElement('div');
        div.className = 'jogo';
        div.innerHTML = \`
          <h3>\${jogo.confronto.match} — \${jogo.confronto.league}</h3>
          <div class="mercados">\${jogo.mercados_visiveis_no_print.map(m => m.mercado + ': ' + m.selecao + ' @ ' + m.odd).join(' | ')}</div>
          <input type="file" accept="image/*" id="stats-\${i}">
          <button onclick="investigar(\${i})">Investigar</button>
          <div class="status" id="status-nexus-\${i}"></div>
          <div id="resumo-nexus-\${i}"></div>
          <button onclick="prepararPublicacao(\${i})" id="btn-publicar-\${i}" disabled>Revisar e Publicar</button>
          <div id="painel-publicar-\${i}"></div>
        \`;
        container.appendChild(div);
      });
    }

    window.investigar = async function (i) {
      const jogo = estado.jogos[i];
      const arquivo = document.getElementById('stats-' + i).files[0];
      const statusEl = document.getElementById('status-nexus-' + i);
      if (!arquivo) { statusEl.textContent = 'Selecione o print de stats.'; statusEl.className = 'status erro'; return; }

      statusEl.textContent = 'Investigando...'; statusEl.className = 'status';
      try {
        const imagemStats = { data: await paraBase64(arquivo), mimeType: arquivo.type };
        const dados = await chamarApi('/api/app/investigar', { esporte: jogo.esporte, imagemStats, confronto: jogo.confronto, mercados_visiveis_no_print: jogo.mercados_visiveis_no_print, contexto_ocr: jogo.contexto_ocr });
        if (!dados.sucesso) throw new Error(dados.erro);

        jogo.nexus = dados.nexus;
        statusEl.textContent = 'Investigação concluída.'; statusEl.className = 'status ok';
        const forca = dados.nexus.analise_coletiva?.resultado_principal?.forca || '?';
        const narrativa = dados.nexus.analise_coletiva?.narrativa?.cenario_provavel || '(sem narrativa)';
        document.getElementById('resumo-nexus-' + i).innerHTML = '<div class="resumo-nexus"><strong>Força: ' + forca + '</strong><br>' + narrativa + '</div>';
        document.getElementById('btn-publicar-' + i).disabled = false;
      } catch (e) {
        statusEl.textContent = 'Erro: ' + e.message; statusEl.className = 'status erro';
      }
    };

    window.prepararPublicacao = function (i) {
      const jogo = estado.jogos[i];
      const payload = {
        confronto: { ...jogo.confronto, sport_key: '' },
        radar: { mercados_visiveis_no_print: jogo.mercados_visiveis_no_print, contexto_ocr: jogo.contexto_ocr },
        nexus: jogo.nexus,
        publicar: 'draft',
      };
      const painel = document.getElementById('painel-publicar-' + i);
      painel.innerHTML = \`
        <p style="font-size:13px;color:#6B7280;">Confira o sport_key (ex: soccer_epl, soccer_brazil_campeonato, basketball_nba, basketball_wnba, baseball_mlb) e edite o JSON se precisar:</p>
        <textarea id="json-\${i}">\${JSON.stringify(payload, null, 2)}</textarea>
        <select id="status-publicar-\${i}"><option value="draft">Rascunho</option><option value="published">Publicado</option></select>
        <button onclick="publicar(\${i})">Publicar</button>
        <div class="status" id="status-final-\${i}"></div>
      \`;
    };

    window.publicar = async function (i) {
      const statusEl = document.getElementById('status-final-' + i);
      statusEl.textContent = 'Publicando...'; statusEl.className = 'status';
      try {
        const payload = JSON.parse(document.getElementById('json-' + i).value);
        payload.publicar = document.getElementById('status-publicar-' + i).value;
        const dados = await chamarApi('/api/app/publicar', payload);
        if (!dados.sucesso) throw new Error(dados.erro);
        statusEl.innerHTML = 'Publicado: <a href="' + dados.publicacao.url + '" target="_blank">' + dados.publicacao.url + '</a>';
        statusEl.className = 'status ok';
      } catch (e) {
        statusEl.textContent = 'Erro: ' + e.message; statusEl.className = 'status erro';
      }
    };
  </script>
</body>
</html>`;

module.exports = async function handler(req, res) {
  // A página em si é pública -- só um formulário sem conteúdo sensível.
  // A senha é exigida em cada ação real (triagem/investigar/publicar),
  // verificada no servidor via appAuth.js.
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.status(200).send(HTML);
};
