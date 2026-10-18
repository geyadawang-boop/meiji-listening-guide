import {Parser} from 'htmlparser2'

/** Recognizes a small inert official bootstrap shell. No returned script is executed. */
export function weixinBootstrap(html: string) {
 if (/<!ENTITY/i.test(html) || /<!DOCTYPE\s+html\s+[^>]/i.test(html)) return false
 let tags = 0,
  limited = false,
  title = '',
  inTitle = false,
  app = false,
  login = false,
  asset = false,
  inert = '',
  depth = 0,
  script: string | undefined,
  ret: string | undefined
 const scripts: string[] = [],
  rets: string[] = []
 const parser = new Parser(
  {
   onopentag(name, attrs) {
    if (++tags > 20000) {
     limited = true
     return
    }
    if (inert) {
     if (name === inert && inert === 'template') depth++
     return
    }
    if (
     [
      'template',
      'noscript',
      'textarea',
      'style',
      'xmp',
      'iframe',
      'noembed',
      'noframes',
      'plaintext',
      'svg',
      'math'
     ].includes(name)
    ) {
     inert = name
     depth = 1
     return
    }
    if (inTitle) return
    if (name === 'title') inTitle = true
    if (name === 'body' && attrs['ng-controller'] === 'appController') app = true
    if (name === 'div' && attrs['ng-controller'] === 'loginController') login = true
    if (name === 'script') {
     script = undefined
     if (attrs.src) {
      try {
       const url = new URL(attrs.src.startsWith('//') ? 'https:' + attrs.src : attrs.src)
       if (
        url.protocol === 'https:' &&
        url.hostname === 'res.wx.qq.com' &&
        !url.port &&
        !url.username &&
        !url.password &&
        /^\/t\/wx_fed\/webwx\/res\/static\/js\/index_[a-f0-9]+\.js$/.test(url.pathname)
       )
        asset = true
      } catch {}
     } else if (!attrs.type || ['text/javascript', 'application/javascript'].includes(attrs.type)) script = ''
    }
    if (name === 'ret' && !Object.keys(attrs).length && script === undefined) ret = ''
   },
   ontext(text) {
    if (limited || inert) return
    if (inTitle) {
     title += text
     if (title.length > 256) limited = true
    }
    if (script !== undefined) {
     script += text
     if (script.length > 16384) limited = true
    }
    if (ret !== undefined) {
     ret += text
     if (ret.length > 64) limited = true
    }
   },
   onclosetag(name) {
    if (inert) {
     if (inert !== 'plaintext' && name === inert && !--depth) inert = ''
     return
    }
    if (inTitle && name !== 'title') return
    if (name === 'title') inTitle = false
    if (name === 'script') {
     if (script !== undefined) scripts.push(script)
     script = undefined
    }
    if (name === 'ret' && ret !== undefined) {
     rets.push(ret.trim())
     ret = undefined
    }
   }
  },
  {decodeEntities: true}
 )
 parser.end(html)
 if (limited || title.trim() !== '微信网页版' || !app || !login || !asset || rets.some(value => value !== '0'))
  return false
 const markers = scripts.flatMap(value => {
  const tokens = (
   value.match(
    /\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|[0-9]+|[^\s]/g
   ) || []
  ).filter(token => token.trim() && !token.startsWith('//') && !token.startsWith('/*'))
  if (!tokens.some(token => ['MMCgi', '"MMCgi"', "'MMCgi'"].includes(token))) return []
  const prefix = ['(', 'function', '(', ')', '{', 'window', '.', 'MMCgi', '=', '{', 'isLogin', ':']
  if (JSON.stringify(tokens.slice(0, prefix.length)) !== JSON.stringify(prefix)) return [false]
  let rest = tokens.slice(prefix.length),
   authenticated = false
  if (['true', 'false'].includes(rest[0])) {
   authenticated = rest[0] === 'true'
   rest = rest.slice(1)
  } else if (rest[0] === '!' && rest[1] === '!' && /^(?:"[^"\\]{0,128}"|'[^'\\]{0,128}')$/.test(rest[2] || '')) {
   authenticated = rest[2].length > 2
   rest = rest.slice(3)
  } else return [false]
  if (rest[0] !== '}' || rest[1] !== ';') return [false]
  rest = rest.slice(2)
  const dev = ['window', '.', 'MMDEV', '=', 'location', '.', 'host', '.', 'indexOf', '(']
  if (
   JSON.stringify(rest.slice(0, 10)) === JSON.stringify(dev) &&
   ['"dev"', "'dev'"].includes(rest[10]) &&
   JSON.stringify(rest.slice(11, 16)) === JSON.stringify([')', '>', '-', '1', ';'])
  )
   rest = rest.slice(16)
  return [authenticated && ['} ) ( )', '} ) ( ) ;'].includes(rest.join(' '))]
 })
 return markers.length === 1 && markers[0] === true
}
