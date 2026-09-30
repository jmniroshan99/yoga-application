import crypto from 'node:crypto';
import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import {ZodError,z} from 'zod';
import {ApiError,config,pool,tx} from './core.js';
import {authRouter,authenticate} from './auth.js';
import {api} from './routes.js';
import {adminRouter} from './admin.js';

if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured.');
if(!/^[a-f0-9]{64}$/i.test(config.key)) throw new Error('DATA_ENCRYPTION_KEY must be 64 hexadecimal characters.');
if(process.env.NODE_ENV==='production'&&!config.secureCookies) throw new Error('Set COOKIE_SECURE=true in production.');
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use(cors({origin:(origin,callback)=>callback(null,!origin||config.webOrigins.includes(origin)),credentials:true}));

// Generic signed payment event seam. A live provider checkout adapter is not bundled.
app.post('/api/v1/payments/webhook',express.raw({type:'application/json',limit:'32kb'}),async(req,res,next)=>{
  try {
    const secret=process.env.PAYMENT_WEBHOOK_SECRET;
    if(!secret||!Buffer.isBuffer(req.body)) throw new ApiError(503,'WEBHOOK_UNAVAILABLE','Webhook is not configured.');
    const received=req.header('x-sahana-signature')||'';
    const expected=crypto.createHmac('sha256',secret).update(req.body).digest('hex');
    if(!/^[a-f0-9]{64}$/i.test(received)||!crypto.timingSafeEqual(Buffer.from(received,'hex'),Buffer.from(expected,'hex')))
      throw new ApiError(401,'INVALID_SIGNATURE','Invalid webhook signature.');
    const event=z.object({eventId:z.string().min(1).max(100),paymentId:z.string().uuid(),type:z.enum(['paid','failed']),amountCents:z.number().int().nonnegative()}).parse(JSON.parse(req.body.toString('utf8')));
    const outcome=await tx(async db=>{
      const payment=(await db.query<{id:string;booking_id:string;amount_cents:number;status:string}>(
        'SELECT * FROM payments WHERE id=$1 FOR UPDATE',[event.paymentId])).rows[0];
      if(!payment) throw new ApiError(404,'PAYMENT_NOT_FOUND','Payment not found.');
      if(payment.amount_cents!==event.amountCents) throw new ApiError(422,'AMOUNT_MISMATCH','Amount does not match.');
      const inserted=await db.query('INSERT INTO payment_events(event_id,payment_id,event_type) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING event_id',
        [event.eventId,payment.id,event.type]);
      if(!inserted.rowCount) return 'duplicate';
      if(payment.status==='paid'||payment.status==='refunded') return 'ignored';
      const booking=(await db.query<{status:string;hold_expires_at:Date;price_cents:number;client_id:string}>(
        'SELECT status,hold_expires_at,price_cents,client_id FROM bookings WHERE id=$1 FOR UPDATE',[payment.booking_id])).rows[0];
      if(!booking||booking.status!=='pending_payment'||new Date(booking.hold_expires_at).getTime()<Date.now()) return 'expired';
      if(event.type==='failed') {
        await db.query("UPDATE payments SET status='failed',updated_at=now() WHERE id=$1",[payment.id]);return 'failed';
      }
      await db.query("UPDATE payments SET status='paid',updated_at=now() WHERE id=$1",[payment.id]);
      await db.query("UPDATE bookings SET status='confirmed',payment_status='paid',hold_expires_at=NULL,updated_at=now() WHERE id=$1",[payment.booking_id]);
      await db.query('INSERT INTO invoices(booking_id,amount_cents) VALUES($1,$2) ON CONFLICT DO NOTHING',[payment.booking_id,booking.price_cents]);
      await db.query("INSERT INTO notification_outbox(user_id,template,payload) VALUES($1,'booking_confirmed',$2)",[booking.client_id,{bookingId:payment.booking_id}]);
      return 'applied';
    });res.json({outcome});
  } catch(error) {next(error);}
});
app.use(express.json({limit:'64kb'}));
app.use(cookieParser());
app.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.path!=='/api/v1/payments/webhook') {
    const origin=req.header('origin');
    if(origin&&!config.webOrigins.includes(origin)) {res.status(403).json({error:{code:'ORIGIN_FORBIDDEN',message:'Request origin not allowed.'}});return;}
    if(req.header('cookie')&&!origin) {res.status(403).json({error:{code:'ORIGIN_REQUIRED',message:'Origin header required for authenticated changes.'}});return;}
  } next();
});
app.use(authenticate);
app.get('/api/v1/health',async(_req,res,next)=>{try {await pool.query('SELECT 1');res.json({status:'ok'});} catch(error){next(error);}});
app.use('/api/v1/auth',authRouter);
app.use('/api/v1/admin',adminRouter);
app.use('/api/v1',api);
app.use('/api',(_req,res)=>res.status(404).json({error:{code:'NOT_FOUND',message:'API route not found.'}}));
const webDist=resolve(dirname(fileURLToPath(import.meta.url)),'../../web/dist');
if(existsSync(webDist)) {
  app.use(express.static(webDist,{index:false}));
  app.get('*',(_req,res)=>res.sendFile(resolve(webDist,'index.html')));
}
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  if(error instanceof ZodError) {res.status(422).json({error:{code:'VALIDATION_ERROR',message:'Check the highlighted fields.',details:error.flatten()}});return;}
  if(error instanceof ApiError) {res.status(error.status).json({error:{code:error.code,message:error.message}});return;}
  if((error as {code?:string}).code==='23P01') {res.status(409).json({error:{code:'RESOURCE_CONFLICT',message:'This slot was just reserved. Choose another time.'}});return;}
  console.error('Server error',error instanceof Error?`${error.name}: ${error.message}`:'unknown');
  res.status(500).json({error:{code:'INTERNAL_ERROR',message:'Something went wrong. Please try again.'}});
});
app.listen(config.port,()=>console.log(`Sahana API on :${config.port}`));
