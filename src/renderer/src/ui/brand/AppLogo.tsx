import mark from './zhaiyun-mark.svg'

/** 摘云应用标识：云朵与摘取的信息碎片。 */
export function AppLogo({size = 28}: {size?: number}) {
 return <img alt="" aria-hidden="true" className="app-logo" draggable={false} src={mark} width={size} />
}
