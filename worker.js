const DEFAULT_WA = "6281334274818";
const CATALOG_KEY = "catalog";

const defaults = [
  {id:"1",name:"Pak Rogo",desc:"Menu makanan dan minuman",hours:"10.00 – 22.00",openTime:"10:00",closeTime:"22:00",address:"Alamat warung",whatsapp:DEFAULT_WA,slides:[]},
  {id:"2",name:"Pak Nikmat",desc:"Menu makanan dan minuman",hours:"10.00 – 22.00",openTime:"10:00",closeTime:"22:00",address:"Alamat warung",whatsapp:DEFAULT_WA,slides:[]},
  {id:"3",name:"Warung 3",desc:"Menu makanan dan minuman",hours:"10.00 – 22.00",openTime:"10:00",closeTime:"22:00",address:"Alamat warung",whatsapp:DEFAULT_WA,slides:[]}
];

const noCache={"Cache-Control":"no-store"};

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "Content-Type":"application/json; charset=utf-8",
      ...noCache
    }
  });
}

function password(env){
  return env.OWNER_PASSWORD || "";
}

function ownerOK(req,env){
  const p=password(env);
  return !!p && req.headers.get("x-owner-password")===p;
}

function parseOpenTime(hours){
  const m=String(hours||"").replace(/\s/g,"").match(/(\d{1,2})[.:](\d{2})[-–—]/);
  return m ? String(m[1]).padStart(2,"0")+":"+m[2] : "";
}

function parseCloseTime(hours){
  const m=String(hours||"").replace(/\s/g,"").match(/[-–—](\d{1,2})[.:](\d{2})/);
  return m ? String(m[1]).padStart(2,"0")+":"+m[2] : "";
}

function validTime(v){
  return !v || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

function store(env){
  if(!env.OLU_KV){
    throw new Error("Cloudflare KV belum terhubung. Buat KV namespace lalu bind dengan nama OLU_KV.");
  }
  return env.OLU_KV;
}

async function getCatalog(env){
  const kv=store(env);
  let value=await kv.get(CATALOG_KEY,"json");

  if(Array.isArray(value)){
    let changed=false;

    for(const w of value){
      if(!w.whatsapp){
        w.whatsapp=DEFAULT_WA;
        changed=true;
      }

      if(!Array.isArray(w.slides)){
        w.slides=[];
        changed=true;
      }

      if(w.openTime===undefined){
        w.openTime=parseOpenTime(w.hours);
        changed=true;
      }

      if(w.closeTime===undefined){
        w.closeTime=parseCloseTime(w.hours);
        changed=true;
      }
    }

    if(changed){
      await kv.put(CATALOG_KEY,JSON.stringify(value));
    }

    return value;
  }

  await kv.put(CATALOG_KEY,JSON.stringify(defaults));
  return structuredClone(defaults);
}

async function saveCatalog(env,catalog){
  await store(env).put(CATALOG_KEY,JSON.stringify(catalog));
}

export default {
  async fetch(req,env){
    const url=new URL(req.url);

    if(url.pathname==="/api/catalog"){
      try{
        const action=url.searchParams.get("action")||"data";

        if(action==="data"){
          return json(await getCatalog(env));
        }

        if(action==="check"){
          return ownerOK(req,env)
            ? json({ok:true})
            : json({ok:false,error:"Password salah"},401);
        }

        if(action==="image"){
          const key=url.searchParams.get("key");

          if(!key){
            return new Response("Key foto tidak ada",{status:400});
          }

          const item=await store(env).getWithMetadata(
            "img:"+key,
            "arrayBuffer"
          );

          if(!item?.value){
            return new Response("Foto tidak ditemukan",{status:404});
          }

          const type=item.metadata?.contentType||"image/jpeg";

          return new Response(item.value,{
            headers:{
              "Content-Type":type,
              "Cache-Control":"public, max-age=31536000, immutable"
            }
          });
        }

        if(!ownerOK(req,env)){
          return json({error:"Akses pemilik ditolak"},401);
        }

        let catalog=await getCatalog(env);

        if(action==="save"){
          const body=await req.json();

          const w=catalog.find(
            x=>String(x.id)===String(body.id)
          );

          if(!w){
            return json({error:"Warung tidak ditemukan"},404);
          }

          w.name=String(body.name||"").trim().slice(0,100);
          w.desc=String(body.desc||"").trim().slice(0,200);
          w.hours=String(body.hours||"").trim().slice(0,100);
          w.openTime=String(body.openTime||"").trim();
          w.closeTime=String(body.closeTime||"").trim();

          if(!validTime(w.openTime)||!validTime(w.closeTime)){
            return json({error:"Jam OPEN/CLOSE tidak valid"},400);
          }

          w.address=String(body.address||"").trim().slice(0,300);

          const rawWA=String(body.whatsapp||"").replace(/\D/g,"");

          if(!rawWA){
            return json({error:"Nomor WhatsApp wajib diisi"},400);
          }

          const wa=rawWA.startsWith("0")
            ?"62"+rawWA.slice(1)
            :rawWA;

          if(!/^62\d{8,14}$/.test(wa)){
            return json({error:"Nomor WhatsApp tidak valid"},400);
          }

          w.whatsapp=wa;

          await saveCatalog(env,catalog);
          return json(catalog);
        }

        if(action==="add"){
          catalog.push({
            id:crypto.randomUUID(),
            name:"Warung Baru",
            desc:"Menu makanan dan minuman",
            hours:"10.00 – 22.00",
            openTime:"10:00",
            closeTime:"22:00",
            address:"Alamat warung",
            whatsapp:DEFAULT_WA,
            slides:[]
          });

          await saveCatalog(env,catalog);
          return json(catalog);
        }

        if(action==="delete"){
          const id=url.searchParams.get("id");

          const w=catalog.find(
            x=>String(x.id)===String(id)
          );

          if(!w){
            return json({error:"Warung tidak ditemukan"},404);
          }

          for(const key of w.slides||[]){
            try{
              await store(env).delete("img:"+key);
            }catch{}
          }

          catalog=catalog.filter(
            x=>String(x.id)!==String(id)
          );

          await saveCatalog(env,catalog);
          return json(catalog);
        }

        if(action==="upload"){
          const form=await req.formData();
          const id=String(form.get("id")||"");
          const file=form.get("file");

          const w=catalog.find(
            x=>String(x.id)===id
          );

          if(!w){
            return json({error:"Warung tidak ditemukan"},404);
          }

          if(!(file instanceof File)){
            return json({error:"File foto tidak diterima server"},400);
          }

          if(!file.type.startsWith("image/")){
            return json({error:"File harus berupa gambar"},400);
          }

          if(file.size>4500000){
            return json({error:"Ukuran foto terlalu besar"},400);
          }

          if((w.slides||[]).length>=50){
            return json({error:"Maksimal 50 foto per warung"},400);
          }

          const key=`${id}/${crypto.randomUUID()}`;

          await store(env).put(
            "img:"+key,
            file.stream(),
            {
              metadata:{
                contentType:file.type||"image/jpeg",
                originalName:file.name||"foto.jpg"
              }
            }
          );

          w.slides=Array.isArray(w.slides)?w.slides:[];
          w.slides.push(key);

          await saveCatalog(env,catalog);

          return json({ok:true,catalog,key});
        }

        if(action==="remove"){
          const id=url.searchParams.get("id");
          const index=Number(url.searchParams.get("i"));

          const w=catalog.find(
            x=>String(x.id)===String(id)
          );

          if(
            !w||
            !Number.isInteger(index)||
            index<0||
            index>=(w.slides||[]).length
          ){
            return json({error:"Foto tidak ditemukan"},404);
          }

          const [key]=w.slides.splice(index,1);

          try{
            await store(env).delete("img:"+key);
          }catch{}

          await saveCatalog(env,catalog);
          return json(catalog);
        }

        return json({error:"Aksi tidak dikenal"},404);

      }catch(err){
        console.error(err);

        return json({
          error:err?.message||"Terjadi kesalahan server"
        },500);
      }
    }

    if(url.pathname==="/"){
      return env.ASSETS
        ? env.ASSETS.fetch(req)
        : new Response("Katalog Olumajang",{status:200});
    }

    if(env.ASSETS){
      return env.ASSETS.fetch(req);
    }

    return new Response("Not found",{status:404});
  }
};
