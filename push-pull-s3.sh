#!/bin/bash

aws s3 sync ./ethereumetl/export s3://ethereum-blockchain-analysis-svitali/ethereumetl/export

aws s3 sync s3://ethereum-blockchain-analysis-svitali .
