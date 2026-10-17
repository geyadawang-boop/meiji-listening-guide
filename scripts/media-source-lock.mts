// Release metadata checked 2026-10-17; tags are not actual tool versions.
export const mediaSources = [
 {
  id: 'eugeneware-b6.1.1-darwin-arm64',
  platform: 'darwin',
  arch: 'arm64',
  repository: 'eugeneware/ffmpeg-static',
  tag: 'b6.1.1',
  distribution: {
   status: 'blocked',
   usage: 'research-only',
   observedToolVersion: '6.0',
   reasons: ['nonfree_build', 'ad_hoc_signature', 'gatekeeper_rejected'],
   evidence: 'https://github.com/geyadawang-boop/meiji-listening-guide/actions/runs/39038682153'
  },
  evidence: 'https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1',
  allowedRedirectHosts: ['github.com', 'release-assets.githubusercontent.com'],
  files: [
   {
    id: 'ffmpeg',
    inputName: 'ffmpeg-darwin-arm64',
    outputName: 'ffmpeg',
    assetId: 316528272,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64',
    size: 45568216,
    sha256: 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
    desiredMode: '0755'
   },
   {
    id: 'ffprobe',
    inputName: 'ffprobe-darwin-arm64',
    outputName: 'ffprobe',
    assetId: 316528835,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64',
    size: 45528808,
    sha256: 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64',
    desiredMode: '0755'
   },
   {
    id: 'README',
    inputName: 'darwin-arm64.README',
    outputName: 'README',
    assetId: 316528259,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/darwin-arm64.README',
    size: 1810,
    sha256: '05ba4b92c96605434b1aaae3eedf5a2c280c9607bf78ffca9a5b536d9af2dc6a',
    desiredMode: '0644'
   },
   {
    id: 'LICENSE',
    inputName: 'darwin-arm64.LICENSE',
    outputName: 'LICENSE',
    assetId: 316528240,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/darwin-arm64.LICENSE',
    size: 4376,
    sha256: 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2',
    desiredMode: '0644'
   }
  ]
 },
 {
  id: 'eugeneware-b6.1.1-linux-x64',
  distribution: {status: 'pending', usage: 'research-only', reasons: []},
  platform: 'linux',
  arch: 'x64',
  repository: 'eugeneware/ffmpeg-static',
  tag: 'b6.1.1',
  evidence: 'https://api.github.com/repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1',
  allowedRedirectHosts: ['github.com', 'release-assets.githubusercontent.com'],
  files: [
   {
    id: 'ffmpeg',
    inputName: 'ffmpeg-linux-x64',
    outputName: 'ffmpeg',
    assetId: 316528533,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64',
    size: 79826272,
    sha256: 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
    desiredMode: '0755'
   },
   {
    id: 'ffprobe',
    inputName: 'ffprobe-linux-x64',
    outputName: 'ffprobe',
    assetId: 316529396,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-linux-x64',
    size: 79665792,
    sha256: '4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d',
    desiredMode: '0755'
   },
   {
    id: 'README',
    inputName: 'linux-x64.README',
    outputName: 'README',
    assetId: 316529927,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.README',
    size: 2235,
    sha256: '72f4b1b06d419d22ace6e7cc75f06826f90737345aa0b1736158929f4aacc537',
    desiredMode: '0644'
   },
   {
    id: 'LICENSE',
    inputName: 'linux-x64.LICENSE',
    outputName: 'LICENSE',
    assetId: 316529924,
    url: 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/linux-x64.LICENSE',
    size: 35147,
    sha256: '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
    desiredMode: '0644'
   }
  ]
 }
] as const
