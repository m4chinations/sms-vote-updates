var config = {};

config.maria = {};
config.twilio = {};
config.sunlight = {};
config.web = {};

config.DEBUG = true;

config.maria.host = 'xxx.xxx.xxx.xxx';
config.maria.user = 'user';
config.maria.pass = 'pw';
config.maria.db   = 'db';

config.twilio.account_sid = '';
config.twilio.auth_token = '';
config.twilio.number = '+14808675309';
config.twilio.endpoint = 'https://';

config.sunlight.api_key = '';


config.web.port = process.env.PORT || 3000;

module.exports = config;
