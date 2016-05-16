'use strict';
let https = require('https');
const API_KEY = require('../apikey');

class TrustScore {

  constructor () {
    this.TP_API_KEY = API_KEY;
    this.TP_HOSTNAME = 'api.trustpilot.com';
    this.TP_ENDPOINTS = {
      FIND_BUSINESS_UNIT_ID: '/v1/business-units/find',
      BUSINESS_GET_REVIEWS: '/v1/business-units/{businessUnitId}/reviews',
      BUSINESS_INFO: '/v1/business-units/{businessUnitId}'
    };
    this.MAX_RESPONSE_SIZE = 4e6;
    this.MAX_REVIEW_AMOUNT = 300;
    // MAX_REVIEW_AGE: Months until the rating should not gain any additional rating score.
    this.MAX_REVIEW_AGE = 36;
    this.MAX_REVIEW_STARS = 5;
    this.business = {};
  }

  /**
   * [Returns the TrustScore response when all data has been prepared at fetched from TP Api.]
   * @param {[string]} domain [required. The domain or name of the business unit.]
   * @return {[object]} [object promise to the calculated trust score.]
   */
  getTrustScore (domain) {
    return new Promise ((resolve, reject) => {
      this.prepareTrustScoreData(domain).then(() => {
        let response = {
          "id": this.business.id,
          "domain": domain,
          "trustScore": this.calculateScore()
        };
        resolve(response);
      }, (error) => {
        reject(error);
      });
    });
  }

  /**
   * [Calculates the trust score based on the reviews that have been fetched.]
   * @return {[number]} [The calculated trust score rounded to one decimal.]
   */
  calculateScore () {
    let index = 0;
    let totalTrustScore = 0;
    let totalReviews = this.business.reviews.length;
    for (index; index < totalReviews; index += 1) {
      let reviewStars = this.business.reviews[index].stars;
      let reviewAge = TrustScore.getMonthsSinceReviewDate(this.business.reviews[index].createdAt);
      let ageModifier = (reviewAge >= this.MAX_REVIEW_AGE ? 0 : (1 - (reviewAge / this.MAX_REVIEW_AGE)));
      let ageScore = (reviewStars / (reviewAge * 2)) / this.MAX_REVIEW_STARS;
      let ratingScore = ((reviewStars / this.MAX_REVIEW_STARS) + ageModifier) +  ageScore;
      ratingScore = (ratingScore > 2 ? 2 : ratingScore);
      if (reviewAge > this.MAX_REVIEW_AGE) {
        reviewStars = reviewStars * (this.MAX_REVIEW_AGE / reviewAge);
      }
      totalTrustScore += reviewStars + (reviewStars * ratingScore) / 2;
    }
    return Math.round((totalTrustScore / totalReviews) * 10 ) / 10;
  }

  /**
   * [Prepares the TrustScore class by firing all the necessary API calls.]
   * @param {[string]} domain [required. The domain or name of the business unit.]
   * @return {[object]} [object promise to all the API data calls.]
   */
  prepareTrustScoreData (domain) {
    return new Promise ((resolve, reject) => {
      this.getBusinessUnitInfo(domain).then((responseData) => {
        this.business.totalReviews = responseData.numberOfReviews.total;
        this.getMaximumBusinessReviews().then(() => {
            resolve(true);
        }, (error) => {
            reject(error, null);
        });
      }, (error) => {
        reject(error, null);
      });
    });
  }

  /**
   * [Calls the /business-units/{businessUnitId} endpoint to get information about the business.]
   * @param {[string]} domain [required. The domain or name of the business unit.]
   * @return {[object]} [object promise to the business unit information.]
   */
  getBusinessUnitInfo (domain) {
    return new Promise ((resolve, reject) => {
      this.findBusinessUnitId(domain).then((responseData) => {
        this.business.id = responseData.id;
        let infoPath = this.TP_ENDPOINTS.BUSINESS_INFO.replace('{businessUnitId}', this.business.id);
        let options = {
          hostname: this.TP_HOSTNAME,
          path: infoPath,
          method: 'GET',
          headers: {
            apikey: this.TP_API_KEY
          }
        };
        this.sendTrustpilotRequest(options, resolve, reject);
      }, (error) => {
        reject (error);
      });
    });
  }

  /**
   * [Calls the /business-units/find endpoint to search for a business matching the given domain.]
   * @param {[string]} domain [required. The domain or name of the business unit.]
   * @return {[object]} [object promise to the business unit id.]
   */
  findBusinessUnitId (domain) {
    return new Promise ((resolve, reject) => {
      let options = {
        hostname: this.TP_HOSTNAME,
        path: this.TP_ENDPOINTS.FIND_BUSINESS_UNIT_ID + '?name=' + domain,
        method: 'GET',
        headers: {
          apikey: this.TP_API_KEY
        }
      };
      this.sendTrustpilotRequest(options, resolve, reject);
    });
  }

  /**
   * [Wrapper to start a recursive promise function call based on the maximum available reviews.]
   * @return {[object]} [object promise to the business reviews.]
   */
  getMaximumBusinessReviews () {
    let page = 1;
    let pages = (this.business.totalReviews > this.MAX_REVIEW_AMOUNT ? (this.MAX_REVIEW_AMOUNT / 100) : Math.ceil(this.business.totalReviews / 100));
    this.business.reviews = [];
    return new Promise ((resolve, reject) => {
        this.runReviewPageRequests(page, pages, resolve, reject);
    });
  }

  /**
   * [Recursively calls the getBusinessReviews function to get the maximum amount of reviews for the business.]
   * @param {[number]} page [required. The page to fetch from API.]
   * @param {[number]} pages [required. Maximum amount of pages available.]
   * @param {[object]} resolve [required. The resolve of the parent function promise.]
   * @param {[object]} reject [required. The reject of the parent function promise.]
   * @return {[object]} [object referring to the next recursive promise in the chain.]
   */
  runReviewPageRequests (page, pages, resolve, reject) {
    this.getBusinessReviews(page).then((data) => {
      this.business.reviews = this.business.reviews.concat(data.reviews);
      if (page < pages) {
        return this.runReviewPageRequests(page + 1, pages, resolve, reject);
      } else {
        resolve(true);
      }
    }, (error) => {
        reject(error);
    });
  }

  /**
   * [Calls the /business-units/{businessUnitId}/reviews endpoint for 100 business reviews per page/call.]
   * @param {[number]} page [required. The page to fetch from API.]
   * @return {[object]} [object promise to the business reviews.]
   */
  getBusinessReviews (page) {
    return new Promise ((resolve, reject) => {
      let path = this.TP_ENDPOINTS.BUSINESS_GET_REVIEWS.replace('{businessUnitId}', this.business.id);
      path = path + '?perPage=100&page=' + page;
      let options = {
        hostname: this.TP_HOSTNAME,
        path: path,
        method: 'GET',
        headers: {
          apikey: this.TP_API_KEY
        }
      };
      this.sendTrustpilotRequest(options, resolve, reject);
    });
  }

  /**
   * [Calls the Trustpilot API with the given options. Resolves and rejects the caller function promises.]
   * @param {[object]} options [required. The https request options.]
   * @param {[object]} resolve [required. The resolve of the parent function promise.]
   * @param {[object]} reject [required. The reject of the parent function promise.]
   * @return {[object]} [object promise to the API https request.]
   */
  sendTrustpilotRequest (options, resolve, reject) {
    let request = https.request(options, (response) => {
      let body = '';
      let responseTooLarge = false;

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > this.MAX_RESPONSE_SIZE) {
          body = "";
          responseTooLarge = true;
        }
      });

      response.on('end', () => {
        if (responseTooLarge) {
          reject(new Error("Request entity too large."));
          return;
        }

        try {
          body = JSON.parse(body);
          if (body.errorCode) {
            reject(new Error(body.message));
          } else {
            resolve(body);
          }
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', (error) => {
      reject(error);
    });
    request.end();
  }

  /**
   * [Counts and returns the number of months between the current date and the given date.]
   * @param {[string]} date [required. The date to count from.]
   * @return {[number]} [number of months since given date.]
   */
  static getMonthsSinceReviewDate(date) {
    let months;
    let reviewDate = new Date(date);
    let today = new Date();
    months = (today.getFullYear() - reviewDate.getFullYear()) * 12;
    months -= reviewDate.getMonth() + 1;
    months += today.getMonth();
    return months <= 0 ? 0 : months;
  }

}
exports.TrustScore = TrustScore;
exports.handler = (event, context, callback) => {
  let trustScore = new TrustScore();
  trustScore.getTrustScore(event.params.domain).then((result) => {
    callback(null, result);
  }, (error) => {
    callback(error, null);
  });
};