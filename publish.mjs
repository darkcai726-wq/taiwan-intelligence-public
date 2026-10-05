// Public artifact publisher. Native Node only; no private source, credentials,
// model calls, dependency install, Actions artifacts or caches.
import {createHash} from 'node:crypto';
export const BACKEND='https://taiwan-situation-intelligence.onrender.com/';
export const MAX_BYTES=64*1024*1024;
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const assetPath=path=>/^(?:index\.html|favicon\.svg|sw\.js|assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2?|svg|png|webp))$/.test(path);
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))throw new Error('public_fields_invalid');}
function article(row){keys(row,['id','title','source','country','url','publishedAt','translation','collectedAt','dateType','contentType','rssPublishedAt']);if(!/^[a-f0-9]{24}$/.test(row.id)||!['台湾','美国','英国','日本'].includes(row.country)||!['title','source','url','publishedAt','translation','collectedAt'].every(key=>typeof row[key]==='string')||!row.url.startsWith('https://')||!Number.isFinite(Date.parse(row.publishedAt))||!Number.isFinite(Date.parse(row.collectedAt)))throw new Error('public_article_invalid');}
export function buildDataFiles(snapshot){
  keys(snapshot,['version','revision','exportedAt','dataUpdatedAt','counts','targets','initialized','articles','analysis','briefing']);
  if(snapshot.version!==1||!snapshot.initialized||!Array.isArray(snapshot.articles)||snapshot.articles.length>100000||!Number.isFinite(Date.parse(snapshot.exportedAt)))throw new Error('public_snapshot_invalid');
  snapshot.articles.forEach(article);
  for(const field of ['counts','targets'])keys(snapshot[field],['台湾','美国','英国','日本']);
  if(snapshot.analysis){keys(snapshot.analysis,['generatedAt','summary','articleIds','relationships']);for(const relation of snapshot.analysis.relationships){keys(relation,['kind','articleIds','explanation','evidenceUrls']);}}
  if(snapshot.briefing){keys(snapshot.briefing,['version','mode','provider','greeting','articles','tactical','tacticalObservedAt','tacticalSources','summary','generatedAt','expiresAt','groundingUrls']);snapshot.briefing.articles.forEach(article);}
  const {revision,exportedAt,...content}=snapshot;
  if(hash(JSON.stringify(content))!==revision)throw new Error('public_revision_mismatch');
  const files=new Map(),index=[],chunks=[];
  for(let offset=0;offset<snapshot.articles.length;offset+=128){const rows=snapshot.articles.slice(offset,offset+128),body=Buffer.from(JSON.stringify(rows)),path=`data/${hash(body)}.json`,chunk=chunks.length;files.set(path,body);chunks.push({path,count:rows.length});rows.forEach(a=>index.push([a.id,a.country,a.publishedAt,chunk]));}
  index.sort((a,b)=>b[2].localeCompare(a[2])||a[0].localeCompare(b[0]));
  const {articles,...rest}=snapshot;
  files.set('snapshot.json',Buffer.from(JSON.stringify({...rest,index,chunks})));
  return files;
}
export function staticHtml(body){
  const html=body.toString();
  if(!html.includes('<head>')||!html.includes('./assets/')||/<(?:script|link)[^>]+(?:src|href)=["'](?:https?:|\/\/|\/assets)/i.test(html))throw new Error('static_html_invalid');
  return Buffer.from(html.replace('<head>','<head>\n    <meta name="intelligence-static" content="1">\n    <meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'; font-src \'self\'; img-src \'self\' data:; connect-src \'self\'; object-src \'none\'; base-uri \'self\'">'));
}
export function sizeCheck(files){let bytes=0;for(const body of files.values())bytes+=body.length;if(bytes>MAX_BYTES)throw new Error('static_capacity_exceeded');return bytes;}

import {pathToFileURL} from 'node:url';
export const REPOSITORY='darkcai726-wq/taiwan-intelligence-public';
const interval=6*60*60*1000,offset=(4*60+10)*60*1000;
export const collectionSlot=time=>Math.floor((time-offset)/interval)*interval+offset;
const gitHash=bytes=>createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
const outputPath=path=>path==='.nojekyll'||path==='publication.json'||path==='snapshot.json'||assetPath(path)||/^data\/[a-f0-9]{64}\.json$/.test(path);

export async function publish({repo=process.env.GITHUB_REPOSITORY,token=process.env.GITHUB_TOKEN,fetcher=fetch,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log,readyAttempts=16,buildAttempts=40}={}){
  if(repo!==REPOSITORY||!token)throw Error('public_self_repository_required');
  const slot=collectionSlot(now());
  async function read(response,limit=MAX_BYTES){
    const parts=[];let bytes=0;
    for await(const part of response.body??[]){bytes+=part.length;if(bytes>limit)throw Error('public_capacity_exceeded');parts.push(part);}
    return Buffer.concat(parts);
  }
  async function response(url,init={}){return fetcher(url,{...init,redirect:'error',signal:AbortSignal.timeout(60000)});}
  async function json(url,init={}){const res=await response(url,init);if(!res.ok)throw Error(`public_http_${res.status}`);return JSON.parse((await read(res)).toString());}
  async function api(path,data,method,missing=false){
    const res=await response(`https://api.github.com/repos/${REPOSITORY}${path}`,{method:method??(data?'POST':'GET'),headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
    if(missing&&res.status===404)return null;
    if(!res.ok)throw Error(`public_github_${res.status}`);
    return JSON.parse((await read(res)).toString());
  }
  async function status(){
    const res=await response(BACKEND+'api/publication?status=1');
    if(res.status===503)return null;
    if(!res.ok)throw Error(`public_readiness_http_${res.status}`);
    const value=JSON.parse((await read(res,4096)).toString());
    if(value.version!==1||value.ready!==true||!Number.isFinite(Date.parse(value.checkedAt)))throw Error('public_readiness_invalid');
    return Date.parse(value.checkedAt)>=slot?value:null;
  }
  const info=await api('');
  if(info.full_name!==REPOSITORY||info.private!==false||info.archived||info.disabled||info.default_branch!=='main')throw Error('public_repository_invalid');
  let ready=null;
  for(let attempt=0;attempt<readyAttempts;attempt++){
    ready=await status();if(ready)break;
    log('Waiting for the existing six-hour collection to finish; no model request.');
    if(attempt+1<readyAttempts)await sleep(240000);
  }
  if(!ready)throw Error('public_collection_not_ready_previous_site_retained');
  const source=await json(BACKEND+'api/publication'),data=buildDataFiles(source);
  const assets=await json(BACKEND+'api/publication/assets');
  if(!Array.isArray(assets.files)||assets.files.length>100||!assets.files.every(file=>assetPath(file.path)&&/^[a-f0-9]{64}$/.test(file.sha256)&&Number.isInteger(file.bytes)&&file.bytes>0&&file.bytes<5*1024*1024)||!assets.files.some(file=>file.path==='index.html')||hash(JSON.stringify(assets.files))!==assets.revision)throw Error('public_assets_invalid');
  const ref=await api('/git/ref/heads/gh-pages',undefined,undefined,true),head=ref?.object?.sha;
  const commit=head?await api(`/git/commits/${head}`):null;
  const tree=commit?await api(`/git/trees/${commit.tree.sha}?recursive=1`):{tree:[]};
  if(tree.truncated||!Array.isArray(tree.tree)||tree.tree.length>2500||tree.tree.some(entry=>entry.type==='blob'&&!outputPath(entry.path)))throw Error('public_artifact_tree_invalid');
  const existing=new Map(tree.tree.filter(e=>e.type==='blob').map(e=>[e.path,e]));
  const pointer=existing.get('publication.json');let previous=null;
  if(pointer){const blob=await api(`/git/blobs/${pointer.sha}`);previous=JSON.parse(Buffer.from(blob.content,'base64').toString());}
  if(previous&&(!Array.isArray(previous.currentFiles)||!Array.isArray(previous.frontendFiles)||!previous.currentFiles.every(outputPath)||!previous.frontendFiles.every(assetPath)))throw Error('public_pointer_invalid');
  if(!pointer&&existing.size)throw Error('public_empty_artifact_branch_required');
  let pages=await api('/pages',undefined,undefined,true);
  if(pages&&(pages.source?.branch!=='gh-pages'||pages.source?.path!=='/'||pages.build_type!=='legacy'))throw Error('public_pages_configuration_invalid');
  const unchanged=previous?.dataRevision===source.revision&&previous?.frontendRevision===assets.revision;
  let target=head;
  if(!unchanged){
    const frontendChanged=previous?.frontendRevision!==assets.revision;
    const files=new Map(data);
    if(frontendChanged)for(const file of assets.files){
      const res=await response(new URL(file.path,BACKEND));if(!res.ok)throw Error(`public_asset_http_${res.status}`);
      const bytes=await read(res,5*1024*1024);if(bytes.length!==file.bytes||hash(bytes)!==file.sha256)throw Error('public_asset_hash_mismatch');
      files.set(file.path,file.path==='index.html'?staticHtml(bytes):bytes);sizeCheck(files);
    }
    files.set('.nojekyll',Buffer.from(''));
    const retained=[...data.keys(),...assets.files.map(file=>file.path)];
    files.set('publication.json',Buffer.from(JSON.stringify({version:1,dataRevision:source.revision,frontendRevision:assets.revision,publishedAt:source.exportedAt,frontendFiles:assets.files.map(file=>file.path),currentFiles:retained,previousFiles:previous?.currentFiles??[]})));
    sizeCheck(files);
    // Check again before publishing: pending writes or a changed frontend are
    // never combined into a partially committed snapshot.
    if(!await status()||(await json(BACKEND+'api/publication')).revision!==source.revision||(await json(BACKEND+'api/publication/assets')).revision!==assets.revision)throw Error('public_export_changed_previous_site_retained');
    const keep=new Set([...retained,...(previous?.currentFiles??[]),'publication.json','.nojekyll']);
    const entries=tree.tree.filter(entry=>entry.type==='blob'&&!keep.has(entry.path)).map(entry=>({path:entry.path,mode:'100644',type:'blob',sha:null}));
    let retainedBytes=0;for(const [path,entry] of existing)if(keep.has(path)&&!files.has(path))retainedBytes+=entry.size??0;
    if(retainedBytes+sizeCheck(files)>2*MAX_BYTES||keep.size>2500)throw Error('public_retained_capacity_exceeded');
    for(const [path,bytes] of files){
      if(existing.get(path)?.sha===gitHash(bytes))continue;
      const blob=await api('/git/blobs',{encoding:'base64',content:bytes.toString('base64')});entries.push({path,mode:'100644',type:'blob',sha:blob.sha});
    }
    const nextTree=await api('/git/trees',{...(commit?{base_tree:commit.tree.sha}:{}),tree:entries});
    const next=await api('/git/commits',{message:`Publish public archive ${source.revision.slice(0,12)}`,tree:nextTree.sha,parents:head?[head]:[]});
    // Update only after every blob/tree is valid. No force push or private
    // source history: the first artifact commit has no parents.
    if(head)await api('/git/refs/heads/gh-pages',{sha:next.sha,force:false},'PATCH');
    else await api('/git/refs',{ref:'refs/heads/gh-pages',sha:next.sha});
    target=next.sha;
  }
  // GITHUB_TOKEN cannot enable Pages: this needs repository administration.
  // The initial artifact branch is now ready for the owner's one-time UI
  // setting: Settings > Pages > Deploy from a branch > gh-pages > /(root).
  if(!pages)throw Error('public_pages_enable_gh_pages_in_repository_settings');
  const latest=await api('/pages/builds/latest',undefined,undefined,true);
  if(unchanged&&latest?.status==='built'&&latest.commit===target){
    log('Snapshot and frontend unchanged; no upload, commit or Pages build.');
    return {state:'unchanged',revision:source.revision,commit:target,url:pages.html_url};
  }
  // A GITHUB_TOKEN push does not automatically start a branch Pages build.
  // Explicitly request it using this repo's short-lived pages:write token.
  // Retry an earlier failed build even when content did not change.
  const requestedNewBuild=latest?.commit!==target||!['queued','building'].includes(latest.status);
  if(requestedNewBuild)await api('/pages/builds',{});
  for(let attempt=0;attempt<buildAttempts;attempt++){
    const build=await api('/pages/builds/latest');
    // A newly requested build can briefly leave latest pointing at the prior
    // failed build. Wait for a new build identity before accepting its status.
    if(requestedNewBuild&&latest?.url&&build.url===latest.url){if(attempt+1<buildAttempts)await sleep(15000);continue;}
    if(build.commit===target&&build.status==='built'){
      log(`Pages built ${target}: ${source.articles.length} articles; model calls 0.`);
      return {state:unchanged?'rebuilt':'published',revision:source.revision,commit:target,url:pages.html_url};
    }
    if(build.commit===target&&['errored','cancelled'].includes(build.status))throw Error('public_pages_build_failed_previous_site_retained');
    if(attempt+1<buildAttempts)await sleep(15000);
  }
  throw Error('public_pages_build_unconfirmed_previous_site_retained');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  publish().then(result=>console.log(result)).catch(error=>{
    const reason=/^public_[a-z0-9_]+$/.test(error?.message??'')?error.message:'public_export_error';
    console.error(`Publication stopped: ${reason}. Previously deployed site remains available.`);process.exitCode=1;
  });
}
