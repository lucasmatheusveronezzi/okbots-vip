'use strict';

function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getHost(a) {
    a = a.replace(/[/slither]/g, '');
    a = a.replace(/[ws]/g, '');
    a = a.replace(/[/]/g, '');
    a = a.substr(1);
    return a;
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function getRandomCoordinates() {
    let maxX = 125;
    let maxY = 125;
    let snakeX = Math.floor(Math.random() * maxX);
    let snakeY = Math.floor(Math.random() * maxY);
    return [snakeX, snakeY];
}

module.exports = {
    getRandomInt,
    getHost,
    lerp,
    getRandomCoordinates
};