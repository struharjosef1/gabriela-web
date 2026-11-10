export function GET() {
  return Response.json({status:'ok',service:'gabriela-web',version:'0.3.0'},{headers:{'Cache-Control':'no-store'}});
}
