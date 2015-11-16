var twilio     = require('twilio'),
    request    = require('request'),
    maria      = require('mariasql'),
    express    = require('express'),
    moment     = require('moment'),
    bodyParser = require('body-parser'),
    config     = require('./config');

var twilio = twilio(config.twilio.account_sid, config.twilio.auth_token);
var myNumber = config.twilio.number;

var app = express();
app.use(bodyParser.urlencoded({extended:true}));

var db = new maria({
    host: config.maria.host,
    user: config.maria.user,
    password: config.maria.pass,
    db: config.maria.db
});

var sunlightAPIKey = config.sunlight.api_key;

var sunlightBill =
    replaceStr('https://congress.api.sunlightfoundation.com/votes?vote_type__in=passage&fields=vote_type,roll_id,bill,voted_at,voter_ids,roll_id,result,breakdown.total&order=voted_at&apikey={{apikey}}',
        { apikey : sunlightAPIKey });
var sunlightLegislatorLookup =
    replaceStr('https://congress.api.sunlightfoundation.com/legislators/locate?zip={{zip}}&apikey={{apikey}}',
        { apikey : sunlightAPIKey });
var sunlightLegislator =
    replaceStr('https://congress.api.sunlightfoundation.com/legislators?bioguide_id={{bid}}&apikey={{apikey}}',
        { apikey : sunlightAPIKey });

var usageStr = "TXT your ZIPCODE to see available legislators. TXT STOP anytime to STOP.";
var legislatorChoiceStr = "TXT Choice number to select your legislator:";
var legislatorChoiceOptionStr = "{{n}}. {{name}}";
var legislatorChoiceConfirm = "Thanks. You are now subscribed to votes by {{name}}. TXT STOP to STOP.";
var voteStr = "{{name}} just voted {{vote}} on {{bill}}. REPLY ? to see breakdown. TXT STOP to STOP.";
var noVoteStr = "{{name}} chose not to vote on {{bill}}. REPLY ? to see breakdown. TXT STOP to STOP.";

var subscribeUserSQL = "INSERT INTO subscriptions (bioguide_id, number) VALUES (:bid, :number)";
var getSubscribersSQL = "SELECT number FROM subscriptions WHERE bioguide_id = :bid";
var unsubscribeSQL = "DELETE FROM subscriptions WHERE number = :number";

var nameCache = {}; //cache bid -> name party-state
var userChoice = {}; //storage for user prompt.

//DEBUG will direct all SMS to go to console.log instead of twilio
var DEBUG = config.DEBUG;

var lastVote = moment().subtract(10, 'days');

app.post('/sms', function(req, res) {
    if (require('twilio').validateExpressRequest(req, config.twilio.auth_token)) {
        var twiml = new twilio.TwimlResponse();
        twiml.message('This HTTP request came from Twilio!');
        console.log(req);
        res.send(twiml);
    }
    else {
        console.log("nope");
        console.log(req);
    }

});

app.get('*', function (req, res) {
    res.send('Hello World');
});

function replaceStr(str, data) {
    Object.keys(data).forEach(function (key) {
        var val = data[key];
        var re = new RegExp('\{\{'+key+'\}\}','g');
        str = str.replace(re, val);
    });
    return str;
}

function incomingZipCode(user, zipcode) {
    request ( {
        url : replaceStr(sunlightLegislatorLookup, {zip: zipcode }),
        json: true
    }, function (err, resp, body) {
        if (!err && resp.statusCode === 200) {
            if (body.results && body.count > 1) {
                /* need user response on which one to subscribe to */
                var message = legislatorChoiceStr;
                userChoice[user] = [];
                body.results.forEach(function (key, idx) {
                    message += ' ' + replaceStr(legislatorChoiceOptionStr, {
                        n : idx,
                        name : sunlightLegislatorToNamePartyState(key)
                    });
                    userChoice[user][idx] = key.bioguide_id;
                });
                sendMessage(user, message);
                console.log(userChoice);
            } else if (body.results.length === 1){
                /* subscrube to only one */
                var bioguide_id = body.results[0].bioguide_id;
                subscribe(user, bioguide_id);
            }
        } else {

        }
    });
}

function routeMessage(user, message) {
    if (/^\d{5}$/.test(message)) {/* zip code */
        console.log("Recived ZIP code from", user, message);
        incomingZipCode(user, message);
    } else if (/^\d{1}$/.test(message)) { /* legislator selection */
        console.log("Recieved legislator choice from", user, message);
        subscribeChoice(user, message);
    } else if (/STOP/i.test(message)) { /* stop message */
        unsubscribe(user);
    } else {
        sendManual(user);
    }
}

function sendManual(user) {
    sendMessage(user, usageStr);
}

function subscribeChoice(user, message) {
    if (userChoice.user && userChoice.user[message])
        subscribe(user, userChoice.user[message]);
    else
        sendManual(user);
}

function subscribe(user, bioguide_id) {
    db.connect();
    db.query(subscribeUserSQL, {number : user, bid : bioguide_id}, function(err, rows) {
        if (err)
            console.log(err);
    });
    db.end();
}

function unsubscribe(user) {
    db.connect();
    db.query(unsubscribeSQL, { number: user }, function (err, rows) {
        if (err)
            console.log(err);
    });
    db.close();
}

function checkForNewVotes(body) {
    /* array where new votes will be held */
    var newVotes = [];
    /* iterate over sunlight recent votes and see if any are newer than what we last parsed */
    for (var i = 0; i < body.results.length; i++) {
        if (lastVote.isBefore(moment(body.results[i].voted_at))) {
            newVotes.push(body.results[i]);
        }
    }
    console.log(newVotes.length, "new votes found.");
    if (newVotes.length > 0) {
        notify(newVotes);
        lastVote = moment(body.results[0].voted_at);
    }
}

/* take in a vote object from sunlight and notify the subscribers of the results */
function notify(votes) {
    for (var i = 0; i < votes.length; i++) { /* for each new vote recieved */
        /* parse out the bill name */
        var vote = votes[i];
        var bill_name;
        if (vote.bill.popular_title) {
            bill_name = vote.bill.popular_title;
        } else if (vote.bill.short_title) {
            bill_name = vote.bill.short_title;
        } else {
            bill_name = vote.bill.official_title;
        }
        /* iterate over legislator votes */
        Object.keys(vote.voter_ids).forEach(function(key) {
            db.connect();
            db.query(getSubscribersSQL, {bid : key}, function(err, rows) {
                if (!err) {
                    if (rows.info.numRows > 0) {
                        /* craft message for each legislator's vote */
                        var val = vote.voter_ids[key];
                        var message = val == "Not Voting" ? noVoteStr : voteStr;

                        /* convert the legislator ID to Name Party-State */
                        bidToName(key, function(legislator_name) {
                            /* Form full message */
                            message = replaceStr(message, {
                                name : legislator_name,
                                vote : val,
                                bill : bill_name
                            });
                            console.log("Found", rows.info.numRows, "subscription(s) for", legislator_name);
                            rows.forEach(function (key) {
                                sendMessage(key.number, message);
                            });
                        });
                    } else {
                    }
                } else {
                    console.log(err);
                }
            });
            db.close();


        });
    }
}

function sunlightLegislatorToNamePartyState(obj) {
    var firstName = obj.nickname ? obj.nickname : obj.first_name;
    var lastName = obj.last_name;
    var name = firstName + ' ' + lastName;
    var partyState = obj.party+'-'+obj.state;
    var full = name + ' ' + partyState;
    return full;
}

function bidToName(bid, cb) {
    if (nameCache.bid) {
        cb(nameCache.bid);
        return;
    }
    request ( {
        url: replaceStr(sunlightLegislator, { bid : bid }),
        json: true
    }, function (err, resp, body) {
        if (!err && resp.statusCode === 200) {
            if (body.count > 0) {
                var full = sunlightLegislatorToNamePartyState(body.results[0]);
                nameCache[bid] = full;
                cb(full);
            }
        } else {
            console.log(err);
        }
    });
}

function sendMessage(number, body) {
    if (DEBUG) {
        console.log("SEND:", body, number);
        return;
    }

    twilio.sendMessage({
        to: number,
        from: myNumber,
        body: body
    }, function(err, resp) {
        if (!err) {
            /* no error */
        } else {
            console.log(err);
        }
    });
}


setInterval(function() {
    request( {
        url : sunlightBill,
        json: true
    }, function (err, resp, body) {
        if (!err && resp.statusCode === 200) {
            checkForNewVotes(body);
        }
    });
}, 60000);

app.listen(config.web.port);
