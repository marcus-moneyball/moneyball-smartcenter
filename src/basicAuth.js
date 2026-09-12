'use strict';

/**
 * Checagem simples de HTTP Basic Auth. Não é um sistema de login de
 * verdade -- é só um cadeado pra impedir que alguém que descubra a URL do
 * app fique gerando chamadas pagas (Gemini/Groq) em seu nome.
 *
 * Configurar em: APP_USUARIO e APP_SENHA (variáveis de ambiente).
 *
 * @returns {boolean} true se autorizado (a rota deve continuar). Se false,
 *   a resposta 401 já foi enviada -- o chamador deve só dar `return`.
 */
function exigirAuthBasica(req, res) {
  const usuarioEsperado = process.env.APP_USUARIO;
  const senhaEsperada = process.env.APP_SENHA;

  if (!usuarioEsperado || !senhaEsperada) {
    console.warn('[APP AUTH] APP_USUARIO/APP_SENHA não configurados -- app fica sem proteção.');
    return true; // fail-open pra não travar o app se esquecer de configurar -- mas loga bem alto
  }

  const cabecalho = req.headers.authorization || '';
  const [, credenciaisBase64] = cabecalho.split(' ');
  const credenciais = credenciaisBase64 ? Buffer.from(credenciaisBase64, 'base64').toString('utf-8') : '';
  const [usuario, senha] = credenciais.split(':');

  if (usuario === usuarioEsperado && senha === senhaEsperada) {
    return true;
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Moneyball Radar App"');
  res.status(401).send('Autenticação necessária.');
  return false;
}

module.exports = { exigirAuthBasica };
