// Maps URLs start from the device location when origin is omitted.
export function pickupNavigation(user,order,payment){
 if(user.role!=='DRIVER'||order.driver_id!==user.id||order.status!=='CLAIMED'||order.delivery_reported_at||payment?.status!=='HELD')return null;
 const coordinate=(value,limit)=>value!==null&&value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Math.abs(Number(value))<=limit;
 const gps=coordinate(order.pickup_lat,90)&&coordinate(order.pickup_lng,180);
 const destination=gps?Number(order.pickup_lat)+','+Number(order.pickup_lng):String(order.pickup||'').trim();
 if(!destination)return null;
 const url=new URL('https://www.google.com/maps/dir/');
 url.searchParams.set('api','1');
 url.searchParams.set('destination',destination);
 url.searchParams.set('travelmode',order.vehicle_type==='MOBIL'?'driving':'two-wheeler');
 url.searchParams.set('dir_action','navigate');
 return {url:url.toString(),source:gps?'GPS':'ADDRESS'};
}
