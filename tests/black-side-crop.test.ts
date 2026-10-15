import {describe,it,expect,vi} from 'vitest'
vi.mock('electron',()=>({nativeImage:{}}))
import {trimBlackSides} from '../src/main/ppt-extract'

function picture(width:number,height:number,bright:(x:number,y:number)=>boolean){
  const bitmap=Buffer.alloc(width*height*4)
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const k=(y*width+x)*4;bitmap[k]=bitmap[k+1]=bitmap[k+2]=bright(x,y)?240:0;bitmap[k+3]=255
  }
  return {getSize:()=>({width,height}),toBitmap:()=>bitmap} as Electron.NativeImage
}
describe('continuous black side cropping',()=>{
  it('keeps a completely black Zhiyun page at its original size',()=>expect(trimBlackSides(picture(200,100,()=>false))).toEqual({left:0,right:1,top:0,bottom:1}))
  it('removes actual continuous bars',()=>{
    expect(trimBlackSides(picture(200,100,x=>x>=20&&x<180))).toEqual({left:.1,right:.9,top:0,bottom:1})
  })
  it('preserves small footer text on a dark slide',()=>{
    const crop=trimBlackSides(picture(1000,600,(x,y)=>(x===120||x===870)&&y>=400&&y<409))
    expect(crop).toEqual({left:0,right:1,top:0,bottom:1})
  })
  it('does not treat transparent margins as black bars',()=>{
    const im=picture(200,100,()=>false);im.toBitmap().fill(0)
    expect(trimBlackSides(im)).toEqual({left:0,right:1,top:0,bottom:1})
  })
})
