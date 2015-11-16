var twilio     = require('twilio'),
    request    = require('request'),
    maria      = require('mariasql'),
    express    = require('express'),
    moment     = require('moment'),
    bodyParser = require('body-parser'),
    config     = require('./config');

/* initalize twilio with creds and our number */
var sms = twilio(config.twilio.account_sid, config.twilio.auth_token);
var myNumber = config.twilio.number;

/* initialize express with some bodyParser magic */
var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:true}));

/* create the db object with our db credentials */
var db = new maria({
    host: config.maria.host,
    user: config.maria.user,
    password: config.maria.pass,
    db: config.maria.db
});

var sunlightAPIKey = config.sunlight.api_key;

/* sunlight congress v3 API endpoints */
var sunlightBill =
    replaceStr('https://congress.api.sunlightfoundation.com/votes?vote_type__in=passage&fields=vote_type,roll_id,bill,voted_at,voter_ids,roll_id,result,breakdown.party&order=voted_at&apikey={{apikey}}',
        { apikey : sunlightAPIKey });
var sunlightLegislatorLookup =
    replaceStr('https://congress.api.sunlightfoundation.com/legislators/locate?zip={{zip}}&apikey={{apikey}}',
        { apikey : sunlightAPIKey });
var sunlightLegislator =
    replaceStr('https://congress.api.sunlightfoundation.com/legislators?bioguide_id={{bid}}&apikey={{apikey}}',
        { apikey : sunlightAPIKey });

/* strings */
var usageStr = "TXT your ZIPCODE to see available legislators. TXT STOP anytime to STOP. TXT CLEAR to clear subscriptions.";
var legislatorChoiceStr = "TXT Choice number to select your legislator:";
var legislatorChoiceOptionStr = "{{n}}. {{name}}";
var legislatorChoiceConfirm = "Thanks. You are now subscribed to votes by {{name}}. TXT STOP to STOP.";
var voteStr = "{{name}} just voted {{vote}} on {{bill}}. REPLY ? to see breakdown. TXT STOP to STOP.";
var noVoteStr = "{{name}} chose not to vote on {{bill}}. REPLY ? to see breakdown. TXT STOP to STOP.";
var breakdownStr = 'R: YEA {{ry}} NAY {{rn}} NV {{rnv}} D: YEA {{dy}} NAY {{dn}} NV {{dnv}} I: YEA {{iy}} NAY {{in}} NV {{inv}}';
var unsubscribeStr = 'You have cleared your subscriptions.';

/* sql statements */
var subscribeUserSQL = "INSERT INTO subscriptions (bioguide_id, number) VALUES (:bid, :number)";
var getSubscribersSQL = "SELECT number FROM subscriptions WHERE bioguide_id = :bid";
var unsubscribeSQL = "DELETE FROM subscriptions WHERE number = :number";

var nameCache = {}; //cache bid -> name party-state
var userChoice = {}; //storage for user prompt.
var userBreakdown = {}; //storage for user breakdown reply

//DEBUG will direct all SMS to go to console.log instead of twilio
var DEBUG = config.DEBUG;

/* by default, set the lastVote to when the app is started */
var lastVote = moment();

/* express handler for incoming SMS post from twilio */
app.post(config.web.endpoint, function(req, res) {
    /* Authenticate that this request is coming from Twilio and not spoofed */
    if(twilio.validateRequest(config.twilio.auth_token,
        req.headers['x-twilio-signature'], config.twilio.endpoint, req.body)) {
            /* pass message to router */
            routeMessage(req.body.From, req.body.Body);
            /* respond that we got the message OK */
            var resp = new twilio.TwimlResponse();
            res.writeHead(200, { 'Content-Type':'text/xml' });
            res.end(resp.toString());
    } else { //was not twilio; don't care
        res.send('nope');
    }
});
/* catchall http(s) GET */
app.get('*', function (req, res) {
    res.send('Hello World');
});

/*
 * replaceStr
 * replaceStr takes in a string with {{these things}} and a data object
 * and will return a string with {{holder}} replaced by { holder: 'whats in the data object' }
 */
function replaceStr(str, data) {
    Object.keys(data).forEach(function (key) {
        var val = data[key];
        var re = new RegExp('\{\{'+key+'\}\}','g');
        str = str.replace(re, val);
    });
    return str;
}
/* process an incoming ZIP code */
function incomingZipCode(user, zipcode) {
    /* lookup the legislators for the zipcode */
    request ( {
        url : replaceStr(sunlightLegislatorLookup, {zip: zipcode }),
        json: true
    }, function (err, resp, body) {
        if (!err && resp.statusCode === 200) { //if everything went ok
            if (body.results && body.count > 1) {
                /* need user response on which one to subscribe to */
                var message = legislatorChoiceStr;
                userChoice[user] = [];
                /* create message and the userChoice prompt */
                body.results.forEach(function (key, idx) {
                    message += ' ' + replaceStr(legislatorChoiceOptionStr, {
                        n : idx + 1,
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
            //err ):
            console.log(err);
        }
    });
}
/* first step an incoming message takes, this will route to the appropriate func */
function routeMessage(user, message) {
    if (/^\d{5}$/.test(message)) {/* zip code */
        console.log("Recived ZIP code from", user, message);
        incomingZipCode(user, message);
    } else if (/^\d{1}$/.test(message)) { /* legislator selection */
        console.log("Recieved legislator choice from", user, message);
        subscribeChoice(user, message);
    } else if (/CLEAR/i.test(message)) { /* clear message */
        unsubscribe(user);
    } else if (/^\?$/.test(message)) { /* breakdown request */
        breakdown(user);
    } else { //what the heck did they type?
        sendManual(user);
    }
}
/* sends a breakdown if one is available, then clears the breakdown cache for that user */
function breakdown(user) {
    if (userBreakdown[user]) {
        sendMessage(user, userBreakdown[user]);
        delete userBreakdown[user];
    }
}
/* sends the manual text to a user */
function sendManual(user) {
    sendMessage(user, usageStr);
}
/* handles a user's legislation selection by checking their userChoice cache */
function subscribeChoice(user, message) {
    if (userChoice[user] && userChoice[user][message - 1]) {
        subscribe(user, userChoice[user][message - 1]);
        delete userChoice[user];
    } else {
        sendManual(user);
    }
}
/* handles a subscription for a user and legislator, indicated by their bioguide_id */
function subscribe(user, bioguide_id) {
    db.connect();
    db.query(subscribeUserSQL, {number : user, bid : bioguide_id}, function(err, rows) {
        if (err)
            console.log(err);
    });
    db.end();
    /* find the name of the legislator and send confirmation message */
    bidToName(bioguide_id, function(name) {
        sendMessage(user, replaceStr(legislatorChoiceConfirm, { name : name }));
    });
}
/* unsubscribes the user from any further notifications */
function unsubscribe(user) {
    db.connect();
    db.query(unsubscribeSQL, { number: user }, function (err, rows) {
        if (err)
            console.log(err);
    });
    db.close();
    sendMessage(user, unsubscribeStr);
}
/* will parse the latest votes and compile one's that are new */
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
        /* take the new votes (may be more than one, if wasn't updated in awhile)
         * and notify people who have subscriptions about the vote */
        notify(newVotes);
        lastVote = moment(body.results[0].voted_at); //store the last vote
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
        //generate the vote breakdown
        var breakdownMessage = replaceStr(breakdownStr, {
            ry : vote.breakdown.party.R.Yea,
            rn : vote.breakdown.party.R.Nay,
            rnv : vote.breakdown.party.R['Not Voting'],
            dy : vote.breakdown.party.D.Yea,
            dn : vote.breakdown.party.D.Nay,
            dnv : vote.breakdown.party.D['Not Voting'],
            iy : vote.breakdown.party.I.Yea,
            in : vote.breakdown.party.I.Nay,
            inv : vote.breakdown.party.I['Not Voting'],
        });
        /* iterate over legislator votes */
        Object.keys(vote.voter_ids).forEach(function(key) {
            db.connect();
            /* query the DB to get subscribers to that legislator */
            db.query(getSubscribersSQL, {bid : key}, function(err, rows) {
                if (!err) {
                    if (rows.info.numRows > 0) { //if someone is subscribed
                        /* craft message for each legislator's vote */
                        var val = vote.voter_ids[key];
                        var message = val == "Not Voting" ? noVoteStr : voteStr;

                        /* convert the legislator b-ID to Name Party-State */
                        bidToName(key, function(legislator_name) {
                            /* Form full message */
                            message = replaceStr(message, {
                                name : legislator_name,
                                vote : val,
                                bill : bill_name
                            });
                            console.log("Found", rows.info.numRows, "subscription(s) for", legislator_name);
                            /* send message to each user subscribed to that legislator */
                            rows.forEach(function (key) {
                                sendMessage(key.number, message);
                                /* store the breakdown so we can send it if prompted for */
                                userBreakdown[key.number] = breakdownMessage;
                            });
                        });
                    } else {
                    }
                } else {
                    console.log(err);
                }
            });
            db.close(); /* close the db connection */
        });
    }
}
/* takes a sunlight legislator object and converts to the form
   Nickname Lastname Party-State. E.g. Jeff Flake R-AZ. If a legislator
   does not have a nickanme, their full first name is used. */
function sunlightLegislatorToNamePartyState(obj) {
    var firstName = obj.nickname ? obj.nickname : obj.first_name;
    var lastName = obj.last_name;
    var name = firstName + ' ' + lastName;
    var partyState = obj.party+'-'+obj.state;
    var full = name + ' ' + partyState;
    return full;
}
/* takes a bioguide-id and returns a full name, party and state
    will pass the name as a parameter to the cb function
*/
function bidToName(bid, cb) {
    if (nameCache.bid) { //lookup if name is cached
        cb(nameCache.bid);
        return;
    }
    /* hit sunlight api to get info */
    request ( {
        url: replaceStr(sunlightLegislator, { bid : bid }),
        json: true
    }, function (err, resp, body) {
        if (!err && resp.statusCode === 200) {
            if (body.count > 0) {
                var full = sunlightLegislatorToNamePartyState(body.results[0]);
                nameCache[bid] = full; //store in cache
                cb(full); //call CB with the full name party state */
            }
        } else {
            console.log(err);
        }
    });
}
/* sends a text message */
function sendMessage(number, body) {
    if (DEBUG) { //if debug, don't send; just log.
        console.log("SEND:", body, number);
        return;
    }
    sms.sendMessage({
        to: number,
        from: myNumber,
        body: body
    }, function(err, resp) {
        if (!err) {
            console.log("SENT:", body, number);
        } else {
            console.log(err);
        }
    });
}

/* set interval to check for new votes! */
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
