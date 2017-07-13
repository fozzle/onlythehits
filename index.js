const oauth = require('oauth');
const express = require('express');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const Joi = require('joi');
const qs = require('qs');

const app = express();

app.use(bodyParser.urlencoded({
  extended: true
}));
app.use(bodyParser.json());

// App Config
app.set('view engine', 'pug');
app.set('views', './views');
app.use(session({
  resave: true,
  secret: process.env.COOKIE_SECRET,
  saveUninitialized: false,
}));

app.use('/static', express.static(path.join(__dirname, 'public')));

// Oauth Config
const twitterOauth = new oauth.OAuth(
  'https://api.twitter.com/oauth/request_token',
  'https://api.twitter.com/oauth/access_token',
  process.env.TWITTER_KEY,
  process.env.TWITTER_SECRET,
  '1.0A',
  'http://localhost:3000/auth/twitter',
  'HMAC-SHA1'
);

const isNumber = (x) => Boolean(Number(x));

app.get('/', (req, res) => {
  res.render('index');
});

const connectSchema = Joi.object().keys({
  minLikes: Joi.number().min(0).integer().required(),
  minRetweets: Joi.number().min(0).integer().required(),
  minAge: Joi.number().min(0).integer().required(),
  includeReplies: Joi.boolean().truthy('on').default(false),
});
app.post('/connect', (req, res) => {
  // Verify inputs
  const { error, value } = Joi.validate(req.body, connectSchema, { abortEarly: false });

  if (error) {
    console.log(error);
    return res.render('index', { errors: error.details });
  }

  req.session.params = value;
  twitterOauth.getOAuthRequestToken((err, oAuthToken, oAuthTokenSecret, results) => {
    const authURL = `https://api.twitter.com/oauth/authenticate?oauth_token=${oAuthToken}`;
    req.session.oauthRequestToken = oAuthToken;
    req.session.oauthRequestTokenSecret = oAuthTokenSecret;
    res.redirect(authURL);
  })
});

app.get('/auth/twitter', (req, res) => {
  console.log('callback called')
  twitterOauth.getOAuthAccessToken(req.session.oauthRequestToken, req.session.oauthRequestTokenSecret, req.query.oauth_verifier, (err, oauthAccessToken, oauthAccessTokenSecret, results) => {
    req.session.oauthAccessToken = oauthAccessToken;
    req.session.oauthAccessTokenSecret = oauthAccessTokenSecret;
    twitterOauth.get('https://api.twitter.com/1.1/account/verify_credentials.json', req.session.oauthAccessToken, req.session.oauthAccessTokenSecret, (err, data, resp) => {
      console.log('verify err', err);
      data = JSON.parse(data);
      req.session.twitterData = data;
      res.redirect('/confirm');
    });
  });
});

app.get('/confirm', (req, res) => {
  res.render('confirm', {
    accountName: req.session.twitterData.screen_name,
    accountAvatar: req.session.twitterData.profile_image_url_https,
    minLikes: req.session.params.minLikes,
    minRetweets: req.session.params.minRetweets,
    minAge: req.session.params.minAge,
    includeReplies: req.session.params.includeReplies,
  });
});

function fetchTweets(params, tweetList, oauthParams) {
  const twitterURL = `https://api.twitter.com/1.1/statuses/user_timeline.json`;
  return new Promise((resolve, reject) => {
    twitterOauth.get(`${twitterURL}?${qs.stringify(params)}`, oauthParams.oauthAccessToken, oauthParams.oauthAccessTokenSecret, (err, data, resp) => {
      if (err) return reject(err);

      data = JSON.parse(data);

      // If this call had max_id, slice off the head to prevent dupe
      if (params.max_id) {
        data.shift();
      }

      tweetList = tweetList.concat(data);
      if (data.length) {
        const newParams = Object.assign(
          {},
          params,
          { max_id: data[data.length - 1].id_str }
        );

        return fetchTweets(newParams, tweetList, oauthParams)
          .then((result) => resolve(result));
      } else {
        return resolve(tweetList);
      }
    });
  });
}

function findMatchingTweets(tweets, params) {
  return tweets.filter((tweet) => {
    return (
      tweet.retweet_count < params.minRetweets &&
      tweet.favorite_count < params.minLikes &&
      (new Date(tweet.created_at)).getTime() < (Date.now() - (1000 * 60 * 60 * 24 * params.minAge))
    );
  });
};

function deleteTweets(tweets, params) {
  const deletions = tweets.map((tweet) => {
    return `https://api.twitter.com/1.1/statuses/destroy/${tweet.id_str}.json`;
  });

  let sequence = Promise.resolve();

  deletions.forEach((deleteURL) => {
    sequence = sequence.then(() => {
      return new Promise((resolve, reject) => {
        twitterOauth.post(deleteURL, params.oauthAccessToken, params.oauthAccessTokenSecret, {}, {}, (err, data, resp) => {
          if (err) return reject(err);
          resolve(JSON.parse(data));
        });
      });
    });
  });
  return sequence;
};

app.post('/confirm', (req, res) => {
  const params = {
    user_id: req.session.twitterData.id_str,
    count: 200,
    exclude_replies: !req.session.params.includeReplies,
  };

  const oauthParams = {
    oauthAccessToken: req.session.oauthAccessToken,
    oauthAccessTokenSecret: req.session.oauthAccessTokenSecret,
  };

  const allTweets = [];
  fetchTweets(params, allTweets, oauthParams)
    .then((tweets) => {
      const matchingTweets = findMatchingTweets(tweets, {
        minRetweets: req.session.params.minRetweets,
        minLikes: req.session.params.minLikes,
        minAge: req.session.params.minAge,
      });

      deleteTweets(matchingTweets, oauthParams);
      return matchingTweets.length;
    })
    .then((matchCount) => {
      return res.send({ ok: true, matched: matchCount });
    })
    .catch((err) => console.log(err));
});

app.listen(process.env.PORT, () => {
  console.log(`App listening on ${process.env.PORT}`);
});
