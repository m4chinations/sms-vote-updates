#sms-vote-updates

##This is a service that texts you when your legislator votes in congress. 

##Live at (202) 791-4401

![Example](https://raw.githubusercontent.com/tennysonholloway/sms-vote-updates/master/eg.png)

To subscribe, text your zipcode, then select from a list of your legislators. 

Here is an example choice of legislator for zipcode 94025:

>TXT Choice number to select your legislator: 1. Jackie Speier D-CA 2. Anna Eshoo D-CA 3. Barbara Boxer D-CA 4. Dianne Feinstein D-CA

Here is an example message when a vote happens:

>Jeff Flake R-AZ just voted Yea on Military Construction and Veterans Affairs and Related Agencies Appropriations Act, 2016. REPLY ? to see breakdown. TXT STOP to STOP.

Here is an example breakdown:

>R: YEA 47 NAY 0 NV 7 D: YEA 44 NAY 0 NV 0 I: YEA 2 NAY 0 NV 0

NV means Not Voting https://en.wikipedia.org/wiki/Abstention

Available inputs are as follows:

* Zipcode
  * If you have one legislator, you will be subscribed to them.
  * If you have more than one legislator, you will be presented with a choice.
* Choice number
  * Will subscribe you to the legislator that cooresponds with your choice.
* CLEAR
  * Will clear your subscriptions
* ?
  * Will show you the vote breakdown for the most recent vote that you have recieved.
* Any other input will display the help message.

Text STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, and QUIT to STOP at anytime. Text START or YES to join back. 


## How does it work? How can I run it myself?
Made possible thanks to the hard work of the [Sunlight Foundation](http://sunlightfoundation.com/) and their [Congress API](https://sunlightlabs.github.io/congress/). SMS serviced by [Twilio](https://www.twilio.com/). 

To run yourself, copy config-sample.js into config.js and fill out the configurations. You'll need a mariadb up and running, twilio creds, and a sunlight api key. 
