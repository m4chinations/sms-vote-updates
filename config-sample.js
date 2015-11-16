var config = {};

config.maria = {};    /* https://mariadb.org/ */
config.twilio = {};   /* https://www.twilio.com/ */
config.sunlight = {}; /* https://sunlightfoundation.com/ */
config.web = {};      /* web port for express */

config.DEBUG = true;  /* if TRUE no texts will be sent, just logged to console */

config.maria.host = 'xxx.xxx.xxx.xxx';
config.maria.user = 'user';
config.maria.pass = 'pw';
config.maria.db   = 'db';

config.twilio.account_sid = ''; /* see https://twilio.github.io/twilio-node/twilio-credentials.gif */
config.twilio.auth_token = '';
config.twilio.number = '+14808675309'; /* YOUR TWILIO NUMBER */

/* Your TWILIO ENDPOINT. This is to receive SMSs.
 * by default this app will listen on /sms for incoming SMS.
 * so in your twilio config you should have your full URL. e.g.
 * https://my-heroku-app-name.heroku.com/sms */
config.twilio.endpoint = 'https://';

config.sunlight.api_key = ''; /* sunlight API key */


config.web.port = process.env.PORT || 3000;
config.web.endpoint = '/sms'; /*where express will listen for incoming SMS */

module.exports = config;
